import { describe, expect, it } from 'vitest';
import { encodeFunctionData, parseAbi, type Hex } from 'viem';
import {
  PHISHING_SPENDER_RISK,
  SAFE_DELEGATECALL_RISK,
  SAFE_HIDDEN_GRANT_RISK,
  SAFE_MISSING_SIGNATURES_RISK,
  SAFE_PACKED_SIGNATURE_BYTES,
  UNLIMITED_APPROVAL_RISK,
  diffReports,
  formatDetectedHeader,
  formatReportFooter,
  generateJsonReport,
  isValidReport,
  renderHtmlReport,
} from '../src';

const TOKEN: Hex = '0xcccccccccccccccccccccccccccccccccccccccc';
const ROUTER: Hex = '0x7a250d5630b4cf539739df2c5dacb4c659f2488d';
const RECIPIENT: Hex = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const PHISHING: Hex = '0xbad0000000000000000000000000000000000001';
const ZERO: Hex = '0x0000000000000000000000000000000000000000';
const SIG: Hex = `0x${'ab'.repeat(SAFE_PACKED_SIGNATURE_BYTES)}`;
const MAX_UINT256 = (1n << 256n) - 1n;

const ERC20_ABI = parseAbi([
  'function approve(address spender, uint256 value)',
  'function transfer(address to, uint256 value)',
]);
const SAFE_ABI = parseAbi([
  'function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures)',
  'function execTransactionFromModule(address to, uint256 value, bytes data, uint8 operation)',
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

function execTransaction(opts: {
  to?: Hex;
  value?: bigint;
  data?: Hex;
  operation?: number;
  signatures?: Hex;
}): Hex {
  return encodeFunctionData({
    abi: SAFE_ABI,
    functionName: 'execTransaction',
    args: [
      opts.to ?? TOKEN,
      opts.value ?? 0n,
      opts.data ?? approve(ROUTER, 5n),
      opts.operation ?? 0,
      0n,
      0n,
      0n,
      ZERO,
      ZERO,
      opts.signatures ?? SIG,
    ],
  });
}

describe('safe_exec reports', () => {
  it('nests an inner approve and rolls its unlimited-approval risk up', () => {
    const report = generateJsonReport(
      execTransaction({ data: approve(ROUTER, MAX_UINT256) })
    )!;
    expect(report.type).toBe('safe_exec');
    if (report.type !== 'safe_exec') return;
    expect(report.payload.variant).toBe('exec_transaction');
    expect(report.payload.operation).toBe('call');
    expect(report.payload.to).toBe(TOKEN);
    expect(report.payload.signatureCount).toBe(1);
    expect(report.payload.innerReport?.type).toBe('erc20_approve');
    expect(report.payload.innerReport?.risks).toEqual([UNLIMITED_APPROVAL_RISK]);
    expect(report.risks).toEqual([
      UNLIMITED_APPROVAL_RISK,
      SAFE_HIDDEN_GRANT_RISK,
    ]);
    expect(report.severity).toBe('high');
    expect(report.payload.depthLimited).toBe(false);
    expect(isValidReport(report)).toBe(true);
  });

  it('keeps a plain inner transfer as info and records the Safe simulation note', () => {
    const report = generateJsonReport(
      execTransaction({ data: transfer(RECIPIENT, 9n) })
    )!;
    expect(report.type).toBe('safe_exec');
    if (report.type !== 'safe_exec') return;
    expect(report.payload.innerReport?.type).toBe('erc20_transfer');
    expect(report.risks).toEqual([]);
    expect(report.severity).toBe('info');
    expect(report.simulation.notes.some((n) => /Safe contract/.test(n))).toBe(
      true
    );
    expect(isValidReport(report)).toBe(true);
  });

  it('treats empty inner data as a native transfer out of the Safe', () => {
    const report = generateJsonReport(
      execTransaction({ data: '0x', value: 500n, to: RECIPIENT })
    )!;
    expect(report.type).toBe('safe_exec');
    if (report.type !== 'safe_exec') return;
    expect(report.payload.innerReport).toBeNull();
    expect(report.payload.value).toBe('500');
    expect(report.simulation.notes.some((n) => n.includes('500 wei'))).toBe(
      true
    );
    expect(formatDetectedHeader(report)).toEqual([
      'Detected: Safe execTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes)',
      `To: ${RECIPIENT}`,
      'Operation: call',
      'Value: 500',
      'Inner: native transfer',
    ]);
    expect(isValidReport(report)).toBe(true);
  });

  it('decodes a module execution with no signature fields', () => {
    const data = encodeFunctionData({
      abi: SAFE_ABI,
      functionName: 'execTransactionFromModule',
      args: [TOKEN, 0n, transfer(RECIPIENT, 1n), 0],
    });
    const report = generateJsonReport(data)!;
    expect(report.type).toBe('safe_exec');
    if (report.type !== 'safe_exec') return;
    expect(report.payload.variant).toBe('module');
    expect(report.payload.signatures).toBeNull();
    expect(report.payload.signatureCount).toBeNull();
    expect(report.payload.innerReport?.type).toBe('erc20_transfer');
    expect(isValidReport(report)).toBe(true);
  });

  it('diffs a new inner spender when the Safe call changes from transfer to approve', () => {
    const baseline = generateJsonReport(
      execTransaction({ data: transfer(RECIPIENT, 1n) })
    )!;
    const candidate = generateJsonReport(
      execTransaction({ data: approve(ROUTER, 8n) })
    )!;
    const diff = diffReports(baseline, candidate);
    expect(diff.candidate.type).toBe('safe_exec');
    expect(diff.addedAddresses).toEqual([
      { address: ROUTER, role: 'spender' },
    ]);
    expect(diff.amountChanges.some((c) => c.field === 'inner.amount')).toBe(
      true
    );
  });

  it('flags DelegateCall and a phishing-listed target', () => {
    const report = generateJsonReport(
      execTransaction({ to: PHISHING, data: '0x', operation: 1 })
    )!;
    expect(report.risks).toEqual([
      SAFE_DELEGATECALL_RISK,
      PHISHING_SPENDER_RISK,
    ]);
    expect(report.severity).toBe('high');
    expect(isValidReport(report)).toBe(true);
  });

  it('flags missing signatures on owner-submitted execTransaction', () => {
    const report = generateJsonReport(
      execTransaction({ data: transfer(RECIPIENT, 1n), signatures: '0x' })
    )!;
    expect(report.risks).toEqual([SAFE_MISSING_SIGNATURES_RISK]);
    expect(report.severity).toBe('warn');
  });

  it('does not treat a Call into a token as a phishing spender hit', () => {
    const report = generateJsonReport(
      execTransaction({ to: PHISHING, data: approve(ROUTER, 8n) })
    )!;
    expect(report.risks).toEqual([SAFE_HIDDEN_GRANT_RISK]);
    expect(report.risks).not.toContain(PHISHING_SPENDER_RISK);
  });

  it('flags a phishing recipient on a native ETH transfer out of the Safe', () => {
    const report = generateJsonReport(
      execTransaction({ to: PHISHING, data: '0x', value: 10n })
    )!;
    expect(report.risks).toEqual([PHISHING_SPENDER_RISK]);
    expect(report.payload).toMatchObject({ innerReport: null, operation: 'call' });
  });

  it('does not raise a hidden-grant warning for a revoke', () => {
    const report = generateJsonReport(
      execTransaction({ data: approve(ROUTER, 0n) })
    )!;
    expect(report.risks).toEqual([]);
    expect(report.severity).toBe('info');
  });

  it('prints inner details in the text footer and HTML table', () => {
    const report = generateJsonReport(
      execTransaction({ data: approve(ROUTER, MAX_UINT256) })
    )!;
    const footer = formatReportFooter(report);
    expect(footer).toContain('Target kind: unknown');
    expect(footer).toContain('Signatures: 1');
    expect(footer.some((line) => line.startsWith('Inner: erc20_approve'))).toBe(
      true
    );
    const html = renderHtmlReport(report);
    expect(html).toContain('<code>safe_exec</code>');
    expect(html).toContain('<th>operation</th><td>call</td>');
    expect(html).not.toContain('delegatecall');
    expect(html).toContain(UNLIMITED_APPROVAL_RISK);
    expect(html).not.toContain('<script');
  });
});
