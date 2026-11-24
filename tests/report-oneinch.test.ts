import { describe, expect, it } from 'vitest';
import { encodeFunctionData, parseAbi, type Hex } from 'viem';
import {
  ONEINCH_HIDDEN_GRANT_RISK,
  ONEINCH_SIGNATURES,
  PHISHING_SPENDER_RISK,
  UNLIMITED_APPROVAL_RISK,
  UNLIMITED_PERMIT_RISK,
  diffReports,
  formatDetectedHeader,
  formatReportFooter,
  generateJsonReport,
  isValidReport,
  renderHtmlReport,
} from '../src';

const TOKEN: Hex = '0xcccccccccccccccccccccccccccccccccccccccc';
const TOKEN_OUT: Hex = '0xdddddddddddddddddddddddddddddddddddddddd';
const EXECUTOR: Hex = '0x1111111111111111111111111111111111111111';
const SRC_RECEIVER: Hex = '0x2222222222222222222222222222222222222222';
const DST_RECEIVER: Hex = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const PHISHING: Hex = '0xbad0000000000000000000000000000000000001';
const CLIPPER: Hex = '0x3333333333333333333333333333333333333333';
const POOL: Hex = '0x4444444444444444444444444444444444444444';
const ROUTER: Hex = '0x7a250d5630b4cf539739df2c5dacb4c659f2488d';
const OWNER: Hex = '0x5555555555555555555555555555555555555555';
const PERMIT_R: Hex = `0x${'ab'.repeat(32)}`;
const PERMIT_S: Hex = `0x${'cd'.repeat(32)}`;
const CLIPPER_R: Hex = `0x${'11'.repeat(32)}`;
const CLIPPER_VS: Hex = `0x${'22'.repeat(32)}`;
const MAX_UINT256 = (1n << 256n) - 1n;

const ERC20_ABI = parseAbi([
  'function approve(address spender, uint256 value)',
  'function transfer(address to, uint256 value)',
]);
const PERMIT_ABI = parseAbi([
  'function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)',
]);
const ONEINCH_ABI = parseAbi([
  'function swap(address executor, (address srcToken, address dstToken, address srcReceiver, address dstReceiver, uint256 amount, uint256 minReturnAmount, uint256 flags) desc, bytes permit, bytes data)',
  'function unoswapTo(address recipient, address srcToken, uint256 amount, uint256 minReturn, uint256[] pools)',
  'function clipperSwapTo(address clipperExchange, address recipient, address srcToken, address dstToken, uint256 inputAmount, uint256 outputAmount, uint256 goodUntil, bytes32 r, bytes32 vs)',
]);

function approve(spender: Hex, value: bigint): Hex {
  return encodeFunctionData({
    abi: ERC20_ABI,
    functionName: 'approve',
    args: [spender, value],
  });
}

function transfer(to: Hex, value: bigint): Hex {
  return encodeFunctionData({
    abi: ERC20_ABI,
    functionName: 'transfer',
    args: [to, value],
  });
}

function permit(spender: Hex, value: bigint): Hex {
  return encodeFunctionData({
    abi: PERMIT_ABI,
    functionName: 'permit',
    args: [OWNER, spender, value, 1_900_000_000n, 27, PERMIT_R, PERMIT_S],
  });
}

function swapDesc() {
  return {
    srcToken: TOKEN,
    dstToken: TOKEN_OUT,
    srcReceiver: SRC_RECEIVER,
    dstReceiver: DST_RECEIVER,
    amount: 10n,
    minReturnAmount: 9n,
    flags: 0n,
  };
}

function swap(opts: { permit?: Hex; data?: Hex } = {}): Hex {
  return encodeFunctionData({
    abi: ONEINCH_ABI,
    functionName: 'swap',
    args: [EXECUTOR, swapDesc(), opts.permit ?? '0x', opts.data ?? '0x'],
  });
}

describe('oneinch reports', () => {
  it('nests an inner approve on the executor and rolls its unlimited-approval risk up', () => {
    const report = generateJsonReport(
      swap({ data: approve(ROUTER, MAX_UINT256) })
    )!;
    expect(report.type).toBe('oneinch');
    if (report.type !== 'oneinch') return;
    expect(report.payload.variant).toBe('swap');
    expect(report.payload.executor).toBe(EXECUTOR);
    expect(report.payload.dstReceiver).toBe(DST_RECEIVER);
    expect(report.payload.executorReport?.type).toBe('erc20_approve');
    expect(report.payload.executorReport?.risks).toEqual([
      UNLIMITED_APPROVAL_RISK,
    ]);
    expect(report.payload.permitReport).toBeNull();
    expect(report.risks).toEqual([
      UNLIMITED_APPROVAL_RISK,
      ONEINCH_HIDDEN_GRANT_RISK,
    ]);
    expect(report.severity).toBe('high');
    expect(report.payload.executorDepthLimited).toBe(false);
    expect(isValidReport(report)).toBe(true);
  });

  it('nests an attached EIP-2612 permit and rolls unlimited_permit up', () => {
    const report = generateJsonReport(
      swap({ permit: permit(ROUTER, MAX_UINT256) })
    )!;
    expect(report.type).toBe('oneinch');
    if (report.type !== 'oneinch') return;
    expect(report.payload.permitReport?.type).toBe('erc20_permit');
    expect(report.payload.permitReport?.risks).toEqual([UNLIMITED_PERMIT_RISK]);
    expect(report.risks).toEqual([
      UNLIMITED_PERMIT_RISK,
      ONEINCH_HIDDEN_GRANT_RISK,
    ]);
    expect(report.severity).toBe('high');
    expect(isValidReport(report)).toBe(true);
  });

  it('keeps a plain inner transfer as info and records the swap simulation note', () => {
    const report = generateJsonReport(
      swap({ data: transfer(DST_RECEIVER, 9n) })
    )!;
    expect(report.type).toBe('oneinch');
    if (report.type !== 'oneinch') return;
    expect(report.payload.executorReport?.type).toBe('erc20_transfer');
    expect(report.risks).toEqual([]);
    expect(report.severity).toBe('info');
    expect(
      report.simulation.notes.some((n) => /Aggregation Router/.test(n))
    ).toBe(true);
    expect(isValidReport(report)).toBe(true);
  });

  it('lists swap fields in the text header', () => {
    const report = generateJsonReport(swap())!;
    expect(report.type).toBe('oneinch');
    expect(formatDetectedHeader(report)).toEqual([
      `Detected: 1inch Aggregation Router ${ONEINCH_SIGNATURES.swap}`,
      `Executor: ${EXECUTOR}`,
      `Src token: ${TOKEN}`,
      `Dst token: ${TOKEN_OUT}`,
      'Amount: 10',
      'Min return: 9',
      `Dst receiver: ${DST_RECEIVER}`,
      'Permit: none',
      'Executor data: none',
    ]);
    expect(isValidReport(report)).toBe(true);
  });

  it('decodes unoswapTo with packed pools', () => {
    const packed = BigInt(POOL);
    const report = generateJsonReport(
      encodeFunctionData({
        abi: ONEINCH_ABI,
        functionName: 'unoswapTo',
        args: [DST_RECEIVER, TOKEN, 10n, 9n, [packed]],
      })
    )!;
    expect(report.type).toBe('oneinch');
    if (report.type !== 'oneinch') return;
    expect(report.payload.variant).toBe('unoswap_to');
    expect(report.payload.recipient).toBe(DST_RECEIVER);
    expect(report.payload.poolAddresses).toEqual([POOL]);
    expect(report.payload.executor).toBeNull();
    expect(report.risks).toEqual([]);
    expect(formatDetectedHeader(report)).toEqual([
      `Detected: 1inch Aggregation Router ${ONEINCH_SIGNATURES.unoswap_to}`,
      `Src token: ${TOKEN}`,
      'Amount: 10',
      'Min return: 9',
      `Recipient: ${DST_RECEIVER}`,
      'Pools: 1',
      'Permit: none',
    ]);
    expect(isValidReport(report)).toBe(true);
  });

  it('decodes clipperSwapTo', () => {
    const report = generateJsonReport(
      encodeFunctionData({
        abi: ONEINCH_ABI,
        functionName: 'clipperSwapTo',
        args: [
          CLIPPER,
          DST_RECEIVER,
          TOKEN,
          TOKEN_OUT,
          10n,
          9n,
          1_900_000_000n,
          CLIPPER_R,
          CLIPPER_VS,
        ],
      })
    )!;
    expect(report.type).toBe('oneinch');
    if (report.type !== 'oneinch') return;
    expect(report.payload.variant).toBe('clipper_swap_to');
    expect(report.payload.clipperExchange).toBe(CLIPPER);
    expect(report.payload.recipient).toBe(DST_RECEIVER);
    expect(report.payload.goodUntil).toBe('1900000000');
    expect(report.risks).toEqual([]);
    expect(
      report.simulation.notes.some((n) => /Clipper exchange/.test(n))
    ).toBe(true);
    expect(isValidReport(report)).toBe(true);
  });

  it('flags a phishing-listed swap destination', () => {
    const data = encodeFunctionData({
      abi: ONEINCH_ABI,
      functionName: 'swap',
      args: [
        EXECUTOR,
        {
          srcToken: TOKEN,
          dstToken: TOKEN_OUT,
          srcReceiver: SRC_RECEIVER,
          dstReceiver: PHISHING,
          amount: 10n,
          minReturnAmount: 9n,
          flags: 0n,
        },
        '0x',
        '0x',
      ],
    });
    const report = generateJsonReport(data)!;
    expect(report.risks).toEqual([PHISHING_SPENDER_RISK]);
    expect(report.severity).toBe('high');
    expect(isValidReport(report)).toBe(true);
  });

  it('flags a phishing-listed unoswap recipient', () => {
    const report = generateJsonReport(
      encodeFunctionData({
        abi: ONEINCH_ABI,
        functionName: 'unoswapTo',
        args: [PHISHING, TOKEN, 10n, 9n, [BigInt(POOL)]],
      })
    )!;
    expect(report.risks).toEqual([PHISHING_SPENDER_RISK]);
    expect(report.severity).toBe('high');
    expect(isValidReport(report)).toBe(true);
  });

  it('does not raise a hidden-grant warning for a revoke', () => {
    const report = generateJsonReport(swap({ data: approve(ROUTER, 0n) }))!;
    expect(report.risks).toEqual([]);
    expect(report.severity).toBe('info');
  });

  it('diffs a new inner spender when a swap adds a hidden approve', () => {
    const baseline = generateJsonReport(
      swap({ data: transfer(DST_RECEIVER, 1n) })
    )!;
    const candidate = generateJsonReport(swap({ data: approve(ROUTER, 8n) }))!;
    const diff = diffReports(baseline, candidate);
    expect(diff.candidate.type).toBe('oneinch');
    expect(diff.addedAddresses).toEqual([
      { address: ROUTER, role: 'spender' },
    ]);
    expect(diff.addedRisks).toEqual([ONEINCH_HIDDEN_GRANT_RISK]);
    expect(diff.amountChanges.some((c) => c.field === 'executor.amount')).toBe(
      true
    );
  });

  it('prints nested executor details in the text footer and HTML table', () => {
    const report = generateJsonReport(
      swap({ data: approve(ROUTER, MAX_UINT256) })
    )!;
    const footer = formatReportFooter(report);
    expect(
      footer.some((line) => line.startsWith(`Recipient: ${DST_RECEIVER}`))
    ).toBe(true);
    expect(
      footer.some((line) =>
        line.startsWith(`Executor ${EXECUTOR}: erc20_approve [high:`)
      )
    ).toBe(true);
    const html = renderHtmlReport(report);
    expect(html).toContain('<code>oneinch</code>');
    expect(html).toContain('<th>variant</th><td>swap</td>');
    expect(html).toContain('executor data');
    expect(html).toContain(UNLIMITED_APPROVAL_RISK);
    expect(html).toContain(ONEINCH_HIDDEN_GRANT_RISK);
    expect(html).not.toContain('<script');
  });
});
