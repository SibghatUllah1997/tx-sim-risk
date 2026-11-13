import { describe, expect, it } from 'vitest';
import { encodeFunctionData, parseAbi } from 'viem';
import {
  APPROVAL_TO_EOA_RISK,
  MAX_UINT256,
  UNLIMITED_PERMIT_RISK,
  createAddressKindMap,
  formatDetectedHeader,
  formatReportFooter,
  generateJsonReport,
  generateJsonReportFromAny,
  isValidReport,
  renderHtmlReport,
} from '../src';

const OWNER = '0x2222222222222222222222222222222222222222';
const SUBMITTER = '0x3333333333333333333333333333333333333333';
const ROUTER = '0x7a250d5630b4cf539739df2c5dacb4c659f2488d';
const EOA = '0x4444444444444444444444444444444444444444';
const R = `0x${'ab'.repeat(32)}` as const;
const S = `0x${'cd'.repeat(32)}` as const;

const EIP2612 = parseAbi([
  'function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)',
]);
const DAI = parseAbi([
  'function permit(address holder, address spender, uint256 nonce, uint256 expiry, bool allowed, uint8 v, bytes32 r, bytes32 s)',
]);

const eip2612 = (spender: string, value: bigint, deadline = 1_900_000_000n) =>
  encodeFunctionData({
    abi: EIP2612,
    functionName: 'permit',
    args: [OWNER, spender as `0x${string}`, value, deadline, 27, R, S],
  });

const dai = (spender: string, allowed: boolean, expiry = 0n) =>
  encodeFunctionData({
    abi: DAI,
    functionName: 'permit',
    args: [OWNER, spender as `0x${string}`, 5n, expiry, allowed, 28, R, S],
  });

const contracts = createAddressKindMap([ROUTER]);

describe('erc20_permit report', () => {
  it('flags an unlimited EIP-2612 permit as high and matches the schema', () => {
    const report = generateJsonReport(eip2612(ROUTER, MAX_UINT256), {
      addressKinds: contracts,
    })!;
    expect(report.type).toBe('erc20_permit');
    if (report.type !== 'erc20_permit') return;
    expect(report.payload).toMatchObject({
      variant: 'eip2612',
      owner: OWNER,
      spender: ROUTER,
      value: MAX_UINT256.toString(),
      nonce: null,
      allowed: null,
      isUnlimitedPermit: true,
      hasNoExpiry: false,
      spenderKind: 'contract',
    });
    expect(report.risks).toEqual([UNLIMITED_PERMIT_RISK]);
    expect(report.severity).toBe('high');
    expect(isValidReport(report)).toBe(true);
  });

  it('keeps a finite permit to a known contract clean', () => {
    const report = generateJsonReport(eip2612(ROUTER, 100n), {
      addressKinds: contracts,
    })!;
    expect(report.risks).toEqual([]);
    expect(report.severity).toBe('info');
  });

  it('applies the approve-to-EOA heuristic to the permit spender', () => {
    const report = generateJsonReport(eip2612(EOA, 100n), {
      bytecodeByAddress: new Map([[EOA, '0x']]),
    })!;
    expect(report.risks).toEqual([APPROVAL_TO_EOA_RISK]);
  });

  it('records the allowance against the signer, not the submitter', () => {
    const report = generateJsonReport(eip2612(ROUTER, 100n), {
      from: SUBMITTER,
      currentAllowance: 40n,
    })!;
    expect(report.simulation.allowances).toEqual([
      {
        owner: OWNER,
        spender: ROUTER,
        mode: 'set',
        delta: '60',
        newValue: '100',
        wouldRevert: false,
      },
    ]);
    expect(report.simulation.notes[0]).toMatch(/off-chain signature/);
  });

  it('reports a DAI allowed=true permit as unlimited with no expiry', () => {
    const report = generateJsonReport(dai(ROUTER, true), {
      addressKinds: contracts,
    })!;
    if (report.type !== 'erc20_permit') throw new Error(report.type);
    expect(report.payload.variant).toBe('dai');
    expect(report.payload.nonce).toBe('5');
    expect(report.payload.allowed).toBe(true);
    expect(report.payload.hasNoExpiry).toBe(true);
    expect(report.risks).toEqual([UNLIMITED_PERMIT_RISK]);
    expect(isValidReport(report)).toBe(true);
  });

  it('does not flag spender heuristics on a DAI revoke', () => {
    const report = generateJsonReport(dai(EOA, false), {
      bytecodeByAddress: new Map([[EOA, '0x']]),
    })!;
    expect(report.risks).toEqual([]);
    expect(report.simulation.allowances[0]!.newValue).toBe('0');
  });

  it('prints plain-text and HTML output', () => {
    const report = generateJsonReportFromAny(dai(ROUTER, true))!;
    const header = formatDetectedHeader(report);
    expect(header[0]).toBe('Detected: ERC-20 DAI-style permit');
    expect(header).toContain('Expiry: 0 (never expires)');
    expect(header).toContain('Nonce: 5');
    expect(header).toContain('Unlimited permit: yes');
    expect(formatReportFooter(report)).toContain('Spender kind: contract');
    const html = renderHtmlReport(report);
    expect(html).toContain('<code>erc20_permit</code>');
    expect(html).toContain(UNLIMITED_PERMIT_RISK);
  });
});
