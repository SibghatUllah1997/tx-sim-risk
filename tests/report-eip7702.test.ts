import { describe, expect, it } from 'vitest';
import { encodeFunctionData, parseAbi, serializeTransaction, type Hex } from 'viem';
import {
  EIP7702_BROAD_DELEGATE_RISK,
  EIP7702_DELEGATION_RISK,
  PHISHING_SPENDER_RISK,
  UNLIMITED_APPROVAL_RISK,
  ZERO_ADDRESS,
  formatDetectedHeader,
  formatReportFooter,
  generateJsonReportFromAny,
  isValidReport,
  renderHtmlReport,
} from '../src';

const DELEGATE = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const ROUTER = '0x7a250d5630b4cf539739df2c5dacb4c659f2488d';
const PHISHING = '0xbad0000000000000000000000000000000000001';
const TO = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const R: Hex = `0x${'11'.repeat(32)}`;
const S: Hex = `0x${'22'.repeat(32)}`;

const APPROVE_ABI = parseAbi([
  'function approve(address spender, uint256 value)',
]);

function approve(spender: string, amount: bigint): Hex {
  return encodeFunctionData({
    abi: APPROVE_ABI,
    functionName: 'approve',
    args: [spender as Hex, amount],
  });
}

function auth(chainId: number, address: Hex) {
  return {
    chainId,
    address,
    nonce: 0,
    r: R,
    s: S,
    yParity: 1 as const,
  };
}

function type4Tx(authorizations: ReturnType<typeof auth>[], data: Hex = '0x'): Hex {
  return serializeTransaction({
    type: 'eip7702',
    chainId: 1,
    nonce: 4,
    maxPriorityFeePerGas: 1n,
    maxFeePerGas: 2n,
    gas: 50_000n,
    to: TO,
    value: 0n,
    data,
    authorizationList: authorizations,
  });
}

describe('eip7702 report', () => {
  it('flags a chain-bound delegate designation and matches the schema', () => {
    const report = generateJsonReportFromAny(type4Tx([auth(1, DELEGATE)]))!;
    expect(report.type).toBe('eip7702');
    if (report.type !== 'eip7702') return;
    expect(report.payload.chainId).toBe('1');
    expect(report.payload.to).toBe(TO);
    expect(report.payload.authorizations[0]).toMatchObject({
      address: DELEGATE,
      isAnyChain: false,
      isRevocation: false,
    });
    expect(report.risks).toEqual([EIP7702_DELEGATION_RISK]);
    expect(report.severity).toBe('high');
    expect(isValidReport(report)).toBe(true);
  });

  it('flags an any-chain designation as broad and a phishing delegate', () => {
    const broad = generateJsonReportFromAny(type4Tx([auth(0, DELEGATE)]))!;
    expect(broad.risks).toEqual([
      EIP7702_DELEGATION_RISK,
      EIP7702_BROAD_DELEGATE_RISK,
    ]);
    expect(broad.severity).toBe('high');

    const phish = generateJsonReportFromAny(type4Tx([auth(1, PHISHING)]))!;
    expect(phish.risks).toEqual([
      EIP7702_DELEGATION_RISK,
      PHISHING_SPENDER_RISK,
    ]);
    expect(isValidReport(phish)).toBe(true);
  });

  it('does not flag a revocation and still analyzes inner calldata', () => {
    const revoke = generateJsonReportFromAny(
      type4Tx([auth(1, ZERO_ADDRESS as Hex)])
    )!;
    expect(revoke.risks).toEqual([]);
    expect(revoke.severity).toBe('info');

    const inner = generateJsonReportFromAny(
      type4Tx(
        [auth(1, DELEGATE)],
        approve(ROUTER, (1n << 256n) - 1n)
      )
    )!;
    expect(inner.type).toBe('eip7702');
    if (inner.type !== 'eip7702') return;
    expect(inner.payload.innerReport?.type).toBe('erc20_approve');
    expect(inner.risks).toEqual([
      EIP7702_DELEGATION_RISK,
      UNLIMITED_APPROVAL_RISK,
    ]);
    expect(isValidReport(inner)).toBe(true);
  });

  it('prints plain-text and HTML output', () => {
    const report = generateJsonReportFromAny(type4Tx([auth(0, DELEGATE)]))!;
    const header = formatDetectedHeader(report);
    expect(header[0]).toBe('Detected: EIP-7702 type-4 transaction');
    expect(header).toContain('Authorizations: 1');
    expect(header.some((line) => line.includes('any-chain'))).toBe(true);
    expect(formatReportFooter(report)).toEqual(
      expect.arrayContaining([
        'Authorizations: 1',
        'Severity: high',
      ])
    );
    const html = renderHtmlReport(report);
    expect(html).toContain('<code>eip7702</code>');
    expect(html).toContain(EIP7702_BROAD_DELEGATE_RISK);
  });
});
