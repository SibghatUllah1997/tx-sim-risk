import { describe, expect, it } from 'vitest';
import { encodeFunctionData, parseAbi, serializeTransaction, type Hex } from 'viem';
import {
  BURN_TO_ZERO_ADDRESS_RISK,
  NATIVE_VALUE_NONPAYABLE_CALL_RISK,
  PHISHING_SPENDER_RISK,
  UNLIMITED_APPROVAL_RISK,
  ZERO_ADDRESS,
  formatDetectedHeader,
  generateJsonReportFromAny,
  isNonPayableReportType,
  isValidReport,
  nativeValueCallRisks,
  reasonForRisk,
  renderHtmlReport,
  severityForRisk,
} from '../src';

const ROUTER = '0x7a250d5630b4cf539739df2c5dacb4c659f2488d';
const PHISHING = '0xbad0000000000000000000000000000000000001';
const TOKEN = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const FRIEND = '0x4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b';
const ONE_ETH = 1_000_000_000_000_000_000n;

const ABI = parseAbi([
  'function approve(address spender, uint256 value)',
  'function multicall(bytes[] data)',
]);

function tx(to: Hex | undefined, value: bigint, data: Hex = '0x'): Hex {
  return serializeTransaction({
    type: 'eip1559',
    chainId: 1,
    nonce: 2,
    gas: 60_000n,
    maxPriorityFeePerGas: 1n,
    maxFeePerGas: 2n,
    to,
    value,
    data,
  });
}

function approve(amount: bigint): Hex {
  return encodeFunctionData({
    abi: ABI,
    functionName: 'approve',
    args: [ROUTER, amount],
  });
}

describe('native value transfers', () => {
  it('reports a plain ETH send with empty calldata', () => {
    const report = generateJsonReportFromAny(tx(FRIEND, ONE_ETH))!;
    expect(report.type).toBe('native_transfer');
    if (report.type !== 'native_transfer') return;
    expect(report.payload).toEqual({
      txType: 'eip1559',
      chainId: '1',
      to: FRIEND,
      value: ONE_ETH.toString(),
      recipientKind: 'unknown',
      isToZeroAddress: false,
    });
    expect(report.risks).toEqual([]);
    expect(report.severity).toBe('info');
    expect(report.simulation.notes).toEqual([
      `Sends ${ONE_ETH} wei of native ETH to ${FRIEND}.`,
    ]);
    expect(isValidReport(report)).toBe(true);
    expect(formatDetectedHeader(report)[0]).toBe(
      'Detected: native ETH transfer (eip1559 tx, no calldata)'
    );
    expect(renderHtmlReport(report)).toContain('value (wei)');
  });

  it('flags ETH sent to the zero address and to a phishing recipient', () => {
    const burn = generateJsonReportFromAny(tx(ZERO_ADDRESS as Hex, 5n))!;
    expect(burn.risks).toEqual([BURN_TO_ZERO_ADDRESS_RISK]);
    expect(burn.severity).toBe('warn');

    const phish = generateJsonReportFromAny(tx(PHISHING as Hex, 5n))!;
    expect(phish.risks).toEqual([PHISHING_SPENDER_RISK]);
    expect(phish.severity).toBe('high');
    expect(isValidReport(phish)).toBe(true);
  });

  it('does not flag a zero-value empty tx (nonce cancel)', () => {
    const report = generateJsonReportFromAny(tx(FRIEND, 0n))!;
    expect(report.type).toBe('native_transfer');
    expect(report.risks).toEqual([]);
    expect(report.simulation.notes[0]).toMatch(/only consumes a nonce/);
  });

  it('flags value attached to a non-payable ERC-20 approve', () => {
    const report = generateJsonReportFromAny(tx(TOKEN, 3n, approve(1n)))!;
    expect(report.type).toBe('erc20_approve');
    expect(report.risks).toEqual([NATIVE_VALUE_NONPAYABLE_CALL_RISK]);
    expect(report.severity).toBe('warn');
    expect(report.riskDetails[0]?.reason).toBe(
      reasonForRisk(NATIVE_VALUE_NONPAYABLE_CALL_RISK)
    );
    expect(report.simulation.notes).toContain(
      `Sends 3 wei of native ETH to ${TOKEN}.`
    );
    expect(isValidReport(report)).toBe(true);
  });

  it('keeps existing risks and severity when value is attached', () => {
    const max = (1n << 256n) - 1n;
    const report = generateJsonReportFromAny(tx(TOKEN, 1n, approve(max)))!;
    expect(report.risks).toEqual([
      UNLIMITED_APPROVAL_RISK,
      NATIVE_VALUE_NONPAYABLE_CALL_RISK,
    ]);
    expect(report.severity).toBe('high');
  });

  it('leaves the same approve without value unchanged', () => {
    const report = generateJsonReportFromAny(tx(TOKEN, 0n, approve(1n)))!;
    expect(report.risks).toEqual([]);
    expect(report.simulation.notes.some((n) => n.includes('native ETH'))).toBe(false);
  });

  it('does not flag value on a payable router multicall', () => {
    const batch = encodeFunctionData({
      abi: ABI,
      functionName: 'multicall',
      args: [[]],
    });
    const report = generateJsonReportFromAny(tx(ROUTER as Hex, ONE_ETH, batch))!;
    expect(report.type).toBe('multicall');
    expect(report.risks).not.toContain(NATIVE_VALUE_NONPAYABLE_CALL_RISK);
    expect(report.simulation.notes).toContain(
      `Sends ${ONE_ETH} wei of native ETH to ${ROUTER}.`
    );
  });

  it('flags value on a type-4 tx whose inner call is non-payable', () => {
    const raw = serializeTransaction({
      type: 'eip7702',
      chainId: 1,
      nonce: 1,
      gas: 50_000n,
      maxPriorityFeePerGas: 1n,
      maxFeePerGas: 2n,
      to: TOKEN,
      value: 2n,
      data: approve(1n),
      authorizationList: [
        {
          chainId: 1,
          address: `0x${'aa'.repeat(20)}`,
          nonce: 0,
          yParity: 1,
          r: `0x${'11'.repeat(32)}`,
          s: `0x${'22'.repeat(32)}`,
        },
      ],
    });
    const report = generateJsonReportFromAny(raw)!;
    expect(report.type).toBe('eip7702');
    expect(report.risks).toContain(NATIVE_VALUE_NONPAYABLE_CALL_RISK);
    expect(report.simulation.notes).toContain(`Sends 2 wei of native ETH to ${TOKEN}.`);
    expect(isValidReport(report)).toBe(true);
  });

  it('exposes the rule helpers', () => {
    expect(severityForRisk(NATIVE_VALUE_NONPAYABLE_CALL_RISK)).toBe('warn');
    expect(isNonPayableReportType('erc20_transfer')).toBe(true);
    expect(isNonPayableReportType('abi_call')).toBe(false);
    expect(nativeValueCallRisks('erc20_transfer', 0n)).toEqual([]);
    expect(nativeValueCallRisks('multicall', 1n)).toEqual([]);
  });
});
