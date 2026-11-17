import { describe, expect, it } from 'vitest';
import { encodeFunctionData, parseAbi, type Hex } from 'viem';
import {
  MAX_MULTICALL_DEPTH,
  MULTICALL3_ADDRESS,
  MULTICALL_BATCHED_GRANT_RISK,
  MULTICALL_DEPTH_LIMIT_RISK,
  PHISHING_SPENDER_RISK,
  UNLIMITED_APPROVAL_RISK,
  createAddressKindMap,
  formatDetectedHeader,
  formatReportFooter,
  generateJsonReport,
  generateJsonReportFromAny,
  isValidReport,
  renderHtmlReport,
} from '../src';

const TOKEN: Hex = '0xcccccccccccccccccccccccccccccccccccccccc';
const SENDER: Hex = '0x1111111111111111111111111111111111111111';
const ROUTER: Hex = '0x7a250d5630b4cf539739df2c5dacb4c659f2488d';
const RECIPIENT: Hex = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const PHISHING: Hex = '0xbad0000000000000000000000000000000000001';
const MAX_UINT256 = (1n << 256n) - 1n;

const ERC20_ABI = parseAbi([
  'function approve(address spender, uint256 value)',
  'function transfer(address to, uint256 value)',
]);
const BATCH_ABI = parseAbi([
  'function multicall(bytes[] data)',
  'function multicall(uint256 deadline, bytes[] data)',
  'function aggregate3((address target, bool allowFailure, bytes callData)[] calls)',
  'function aggregate3Value((address target, bool allowFailure, uint256 value, bytes callData)[] calls)',
]);

const contracts = createAddressKindMap([ROUTER]);

function approve(spender: Hex, value: bigint): Hex {
  return encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [spender, value] });
}

function transfer(to: Hex, value: bigint): Hex {
  return encodeFunctionData({ abi: ERC20_ABI, functionName: 'transfer', args: [to, value] });
}

function multicall(calls: Hex[]): Hex {
  return encodeFunctionData({ abi: BATCH_ABI, functionName: 'multicall', args: [calls] });
}

function aggregate3(calls: { target: Hex; callData: Hex; allowFailure?: boolean }[]): Hex {
  return encodeFunctionData({
    abi: BATCH_ABI,
    functionName: 'aggregate3',
    args: [calls.map((c) => ({ target: c.target, allowFailure: c.allowFailure ?? false, callData: c.callData }))],
  });
}

describe('multicall reports', () => {
  it('flags an unlimited approve hidden in a router multicall', () => {
    const report = generateJsonReport(
      multicall([transfer(RECIPIENT, 5n), approve(ROUTER, MAX_UINT256)]),
      { from: SENDER, addressKinds: contracts }
    )!;
    if (report.type !== 'multicall') throw new Error(report.type);
    expect(report.payload.variant).toBe('multicall');
    expect(report.payload.forwardsAsContract).toBe(false);
    expect(report.payload.calls.map((c) => c.report?.type)).toEqual([
      'erc20_transfer',
      'erc20_approve',
    ]);
    expect(report.payload.calls[1]!.selector).toBe('0x095ea7b3');
    expect(report.risks).toEqual([UNLIMITED_APPROVAL_RISK, MULTICALL_BATCHED_GRANT_RISK]);
    expect(report.severity).toBe('high');
    expect(report.simulation.balances).toEqual([
      { account: SENDER, delta: '-5' },
      { account: RECIPIENT, delta: '5' },
    ]);
    expect(report.simulation.allowances[0]!.owner).toBe(SENDER);
    expect(isValidReport(report)).toBe(true);
  });

  it('does not raise a batched-grant warning for plain transfers or a revoke', () => {
    const report = generateJsonReport(
      multicall([transfer(RECIPIENT, 5n), approve(ROUTER, 0n)]),
      { addressKinds: contracts }
    )!;
    expect(report.risks).toEqual([]);
    expect(report.severity).toBe('info');
  });

  it('records Multicall3 effects against the Multicall3 contract and keeps targets', () => {
    const report = generateJsonReport(
      aggregate3([
        { target: TOKEN, callData: approve(PHISHING, 10n), allowFailure: true },
      ]),
      { from: SENDER }
    )!;
    if (report.type !== 'multicall') throw new Error(report.type);
    expect(report.payload.forwardsAsContract).toBe(true);
    expect(report.payload.calls[0]!.target).toBe(TOKEN);
    expect(report.payload.calls[0]!.allowFailure).toBe(true);
    expect(report.risks).toContain(PHISHING_SPENDER_RISK);
    expect(report.risks).toContain(MULTICALL_BATCHED_GRANT_RISK);
    expect(report.simulation.allowances[0]!.owner).toBe(MULTICALL3_ADDRESS);
    expect(report.simulation.notes.some((n) => n.includes('Multicall3'))).toBe(true);
    expect(isValidReport(report)).toBe(true);
  });

  it('keeps unrecognized inner calls with a null report', () => {
    const report = generateJsonReport(
      aggregate3([
        { target: TOKEN, callData: '0xdeadbeef' },
        { target: TOKEN, callData: '0x' },
      ])
    )!;
    if (report.type !== 'multicall') throw new Error(report.type);
    expect(report.payload.calls.map((c) => [c.selector, c.report])).toEqual([
      ['0xdeadbeef', null],
      [null, null],
    ]);
    expect(report.risks).toEqual([]);
    expect(isValidReport(report)).toBe(true);
  });

  it('sums forwarded ETH from aggregate3Value', () => {
    const report = generateJsonReport(
      encodeFunctionData({
        abi: BATCH_ABI,
        functionName: 'aggregate3Value',
        args: [[
          { target: RECIPIENT, allowFailure: false, value: 2n, callData: '0x' },
          { target: TOKEN, allowFailure: false, value: 3n, callData: transfer(RECIPIENT, 1n) },
        ]],
      })
    )!;
    if (report.type !== 'multicall') throw new Error(report.type);
    expect(report.payload.totalValue).toBe('5');
    expect(report.payload.calls.map((c) => c.value)).toEqual(['2', '3']);
  });

  it('follows nested batches and stops at the depth limit', () => {
    let nested: Hex = approve(ROUTER, MAX_UINT256);
    for (let i = 0; i < MAX_MULTICALL_DEPTH; i++) nested = multicall([nested]);
    const deepest = generateJsonReport(nested, { addressKinds: contracts })!;
    expect(deepest.risks).toEqual([UNLIMITED_APPROVAL_RISK, MULTICALL_BATCHED_GRANT_RISK]);
    expect(isValidReport(deepest)).toBe(true);

    const tooDeep = generateJsonReport(multicall([nested]), { addressKinds: contracts })!;
    expect(tooDeep.risks).toContain(MULTICALL_DEPTH_LIMIT_RISK);
    expect(tooDeep.risks).not.toContain(UNLIMITED_APPROVAL_RISK);
    const lines = formatReportFooter(tooDeep).join('\n');
    expect(lines).toContain('nested batch not analyzed (depth limit)');
  });

  it('returns null from the any-input path for a truncated batch', () => {
    const data = multicall([approve(ROUTER, 1n)]);
    expect(generateJsonReportFromAny(data.slice(0, 90))).toBeNull();
  });

  it('prints plain-text and HTML output with one line per inner call', () => {
    const data = encodeFunctionData({
      abi: BATCH_ABI,
      functionName: 'multicall',
      args: [1_900_000_000n, [approve(ROUTER, MAX_UINT256), multicall([transfer(RECIPIENT, 1n)])]],
    });
    const report = generateJsonReportFromAny(data, { addressKinds: contracts })!;
    const header = formatDetectedHeader(report);
    expect(header[0]).toBe('Detected: multicall(uint256,bytes[]) batch');
    expect(header).toContain('Calls: 2');
    expect(header).toContain('Deadline: 1900000000');
    expect(header).toContain('Inner calls run as: original sender');
    const footer = formatReportFooter(report);
    expect(footer).toContain('Call [0]: erc20_approve [high: unlimited_approval]');
    expect(footer).toContain('Call [1]: multicall');
    expect(footer).toContain('  Call [0]: erc20_transfer');
    const html = renderHtmlReport(report);
    expect(html).toContain('<code>multicall</code>');
    expect(html).toContain(MULTICALL_BATCHED_GRANT_RISK);
  });
});
