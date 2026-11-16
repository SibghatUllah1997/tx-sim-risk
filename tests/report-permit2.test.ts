import { describe, expect, it } from 'vitest';
import { encodeFunctionData, parseAbi, type Hex } from 'viem';
import {
  APPROVAL_TO_EOA_RISK,
  MAX_UINT160,
  MAX_UINT48,
  PERMIT2_NO_EXPIRY_RISK,
  PHISHING_SPENDER_RISK,
  UNLIMITED_APPROVAL_RISK,
  UNLIMITED_PERMIT_RISK,
  createAddressKindMap,
  formatDetectedHeader,
  formatReportFooter,
  generateJsonReport,
  generateJsonReportFromAny,
  isValidReport,
  renderHtmlReport,
} from '../src';

const TOKEN = '0xcccccccccccccccccccccccccccccccccccccccc';
const OWNER = '0x1111111111111111111111111111111111111111';
const SUBMITTER = '0x3333333333333333333333333333333333333333';
const ROUTER = '0x7a250d5630b4cf539739df2c5dacb4c659f2488d';
const EOA = '0x4444444444444444444444444444444444444444';
const PHISHING = '0xbad0000000000000000000000000000000000001';
const RECIPIENT = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const SIGNATURE: Hex = `0x${'ab'.repeat(65)}`;
const EXPIRATION = 1_900_000_000n;
const DEADLINE = 1_900_000_000n;

const APPROVE_ABI = parseAbi([
  'function approve(address token, address spender, uint160 amount, uint48 expiration)',
]);
const PERMIT_ABI = parseAbi([
  'function permit(address owner, ((address token, uint160 amount, uint48 expiration, uint48 nonce) details, address spender, uint256 sigDeadline) permitSingle, bytes signature)',
]);
const TRANSFER_ABI = parseAbi([
  'function permitTransferFrom(((address token, uint256 amount) permitted, uint256 nonce, uint256 deadline) permit, (address to, uint256 requestedAmount) transferDetails, address owner, bytes signature)',
]);

const approve = (spender: string, amount: bigint, expiration = EXPIRATION) =>
  encodeFunctionData({
    abi: APPROVE_ABI,
    functionName: 'approve',
    args: [TOKEN, spender as Hex, amount, expiration],
  });

const permit = (
  spender: string,
  amount: bigint,
  expiration = EXPIRATION,
  deadline = DEADLINE
) =>
  encodeFunctionData({
    abi: PERMIT_ABI,
    functionName: 'permit',
    args: [
      OWNER,
      {
        details: { token: TOKEN, amount, expiration, nonce: 4n },
        spender: spender as Hex,
        sigDeadline: deadline,
      },
      SIGNATURE,
    ],
  });

const transferFrom = (to: string, amount: bigint, requested = amount) =>
  encodeFunctionData({
    abi: TRANSFER_ABI,
    functionName: 'permitTransferFrom',
    args: [
      { permitted: { token: TOKEN, amount }, nonce: 9n, deadline: DEADLINE },
      { to: to as Hex, requestedAmount: requested },
      OWNER,
      SIGNATURE,
    ],
  });

const contracts = createAddressKindMap([ROUTER]);

describe('permit2 report', () => {
  it('flags an unlimited never-expiring approve as high and matches the schema', () => {
    const report = generateJsonReport(approve(ROUTER, MAX_UINT160, MAX_UINT48), {
      addressKinds: contracts,
    })!;
    expect(report.type).toBe('permit2');
    if (report.type !== 'permit2') return;
    expect(report.payload).toMatchObject({
      variant: 'approve',
      owner: null,
      spender: ROUTER,
      token: TOKEN,
      amount: MAX_UINT160.toString(),
      expiration: MAX_UINT48.toString(),
      deadline: null,
      isUnlimited: true,
      hasNoExpiry: true,
      spenderKind: 'contract',
    });
    expect(report.risks).toEqual([UNLIMITED_APPROVAL_RISK, PERMIT2_NO_EXPIRY_RISK]);
    expect(report.severity).toBe('high');
    expect(isValidReport(report)).toBe(true);
  });

  it('keeps a finite approve to a known contract clean, including expiration 0', () => {
    const finite = generateJsonReport(approve(ROUTER, 100n), {
      addressKinds: contracts,
    })!;
    expect(finite.risks).toEqual([]);
    expect(finite.severity).toBe('info');

    const immediate = generateJsonReport(approve(ROUTER, 100n, 0n), {
      addressKinds: contracts,
    })!;
    if (immediate.type !== 'permit2') throw new Error(immediate.type);
    expect(immediate.payload.hasNoExpiry).toBe(false);
    expect(immediate.risks).toEqual([]);
  });

  it('applies spender heuristics to a signed permit and records the signer as owner', () => {
    const eoa = generateJsonReport(permit(EOA, 100n), {
      from: SUBMITTER,
      currentAllowance: 40n,
      bytecodeByAddress: new Map([[EOA, '0x']]),
    })!;
    expect(eoa.risks).toEqual([APPROVAL_TO_EOA_RISK]);
    expect(eoa.simulation.allowances).toEqual([
      {
        owner: OWNER,
        spender: EOA,
        mode: 'set',
        delta: '60',
        newValue: '100',
        wouldRevert: false,
      },
    ]);
    expect(eoa.simulation.notes[0]).toMatch(/Permit2/);

    const unlimited = generateJsonReport(permit(ROUTER, MAX_UINT160), {
      addressKinds: contracts,
    })!;
    expect(unlimited.risks).toEqual([UNLIMITED_PERMIT_RISK]);
    expect(unlimited.severity).toBe('high');
    expect(isValidReport(unlimited)).toBe(true);
  });

  it('simulates permitTransferFrom as a pull to the recipient and flags a phishing to', () => {
    const clean = generateJsonReport(transferFrom(RECIPIENT, 80n), {
      from: SUBMITTER,
    })!;
    if (clean.type !== 'permit2') throw new Error(clean.type);
    expect(clean.payload.variant).toBe('permit_transfer_from');
    expect(clean.payload.to).toBe(RECIPIENT);
    expect(clean.payload.requestedAmount).toBe('80');
    expect(clean.payload.spenderKind).toBeNull();
    expect(clean.risks).toEqual([]);
    expect(clean.simulation.balances).toEqual([
      { account: OWNER, delta: '-80' },
      { account: RECIPIENT, delta: '80' },
    ]);

    const phish = generateJsonReport(transferFrom(PHISHING, 80n))!;
    expect(phish.risks).toEqual([PHISHING_SPENDER_RISK]);
    expect(phish.severity).toBe('high');
    expect(isValidReport(phish)).toBe(true);
  });

  it('prints plain-text and HTML output', () => {
    const report = generateJsonReportFromAny(
      approve(ROUTER, MAX_UINT160, MAX_UINT48)
    )!;
    const header = formatDetectedHeader(report);
    expect(header[0]).toBe('Detected: Permit2 approve');
    expect(header).toContain(`Token: ${TOKEN}`);
    expect(header).toContain(`Spender: ${ROUTER}`);
    expect(header).toContain('Never expires: yes');
    expect(header).toContain('Unlimited: yes');
    expect(formatReportFooter(report)).toContain('Spender kind: contract');
    const html = renderHtmlReport(report);
    expect(html).toContain('<code>permit2</code>');
    expect(html).toContain(UNLIMITED_APPROVAL_RISK);
    expect(html).toContain(PERMIT2_NO_EXPIRY_RISK);
  });
});
