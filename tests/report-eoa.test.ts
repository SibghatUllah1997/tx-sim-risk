import { describe, it, expect } from 'vitest';
import {
  APPROVAL_TO_EOA_RISK,
  PHISHING_SPENDER_RISK,
  createAddressKindMap,
} from '../src';
import { generateJsonReport } from '../src/report';

function pad32Bytes(hexNoPrefix: string): string {
  return hexNoPrefix.padStart(64, '0');
}

function encodeApprove(spenderNo0x: string, amountHex: string): string {
  return `0x095ea7b3${pad32Bytes(`000000000000000000000000${spenderNo0x}`)}${pad32Bytes(amountHex)}`;
}

function encodeIncrease(spenderNo0x: string, deltaHex: string): string {
  return `0x39509351${pad32Bytes(`000000000000000000000000${spenderNo0x}`)}${pad32Bytes(deltaHex)}`;
}

function encodeDecrease(spenderNo0x: string, deltaHex: string): string {
  return `0xa457c2d7${pad32Bytes(`000000000000000000000000${spenderNo0x}`)}${pad32Bytes(deltaHex)}`;
}

function encodeSetApprovalForAll(
  operatorNo0x: string,
  approved: boolean
): string {
  return `0xa22cb465${pad32Bytes(`000000000000000000000000${operatorNo0x}`)}${pad32Bytes(approved ? '1' : '0')}`;
}

const EOA = '1111111111111111111111111111111111111111';
const ROUTER = '7a250d5630b4cf539739df2c5dacb4c659f2488d';
const PHISH = 'bad0000000000000000000000000000000000001';

describe('JSON report EOA vs contract approval rule', () => {
  it('flags an ERC-20 approve granted to an EOA and records spenderKind', () => {
    const report = generateJsonReport(encodeApprove(EOA, '64'), {
      bytecodeByAddress: new Map([[`0x${EOA}`, '0x']]),
    })!;
    expect(report.type).toBe('erc20_approve');
    if (report.type !== 'erc20_approve') return;
    expect(report.payload.spenderKind).toBe('eoa');
    expect(report.risks).toEqual([APPROVAL_TO_EOA_RISK]);
  });

  it('does not flag a revoke (zero amount) to an EOA', () => {
    const report = generateJsonReport(encodeApprove(EOA, '0'), {
      bytecodeByAddress: new Map([[`0x${EOA}`, '0x']]),
    })!;
    expect(report.type).toBe('erc20_approve');
    if (report.type !== 'erc20_approve') return;
    expect(report.payload.spenderKind).toBe('eoa');
    expect(report.risks).toEqual([]);
  });

  it('classifies a known router as a contract with no EOA risk', () => {
    const report = generateJsonReport(encodeApprove(ROUTER, '64'))!;
    expect(report.type).toBe('erc20_approve');
    if (report.type !== 'erc20_approve') return;
    expect(report.payload.spenderKind).toBe('contract');
    expect(report.risks).toEqual([]);
  });

  it('classifies an unlisted spender as unknown without EOA risk', () => {
    const report = generateJsonReport(encodeApprove(EOA, '64'))!;
    expect(report.type).toBe('erc20_approve');
    if (report.type !== 'erc20_approve') return;
    expect(report.payload.spenderKind).toBe('unknown');
    expect(report.risks).toEqual([]);
  });

  it('lets bytecode mark a known contract as an EOA (stale/wrong code)', () => {
    const report = generateJsonReport(encodeApprove(ROUTER, '1'), {
      bytecodeByAddress: new Map([[`0x${ROUTER}`, '0x']]),
    })!;
    expect(report.type).toBe('erc20_approve');
    if (report.type !== 'erc20_approve') return;
    expect(report.payload.spenderKind).toBe('eoa');
    expect(report.risks).toEqual([APPROVAL_TO_EOA_RISK]);
  });

  it('flags increaseAllowance to an EOA and skips decreaseAllowance', () => {
    const bytecodeByAddress = new Map([[`0x${EOA}`, '0x']]);
    const inc = generateJsonReport(encodeIncrease(EOA, '2a'), {
      bytecodeByAddress,
    })!;
    expect(inc.type).toBe('erc20_increaseAllowance');
    if (inc.type !== 'erc20_increaseAllowance') return;
    expect(inc.payload.spenderKind).toBe('eoa');
    expect(inc.risks).toEqual([APPROVAL_TO_EOA_RISK]);

    const dec = generateJsonReport(encodeDecrease(EOA, '07'), {
      bytecodeByAddress,
    })!;
    expect(dec.type).toBe('erc20_decreaseAllowance');
    if (dec.type !== 'erc20_decreaseAllowance') return;
    expect(dec.payload.spenderKind).toBe('eoa');
    expect(dec.risks).toEqual([]);
  });

  it('flags NFT operator grants to an EOA and skips revocations', () => {
    const bytecodeByAddress = new Map([[`0x${EOA}`, '0x']]);
    const grant = generateJsonReport(encodeSetApprovalForAll(EOA, true), {
      bytecodeByAddress,
    })!;
    expect(grant.type).toBe('nft_setApprovalForAll');
    if (grant.type !== 'nft_setApprovalForAll') return;
    expect(grant.payload.operatorKind).toBe('eoa');
    expect(grant.risks).toContain(APPROVAL_TO_EOA_RISK);
    expect(grant.risks).toContain('erc721_approve_all');

    const revoke = generateJsonReport(encodeSetApprovalForAll(EOA, false), {
      bytecodeByAddress,
    })!;
    expect(revoke.type).toBe('nft_setApprovalForAll');
    if (revoke.type !== 'nft_setApprovalForAll') return;
    expect(revoke.payload.operatorKind).toBe('eoa');
    expect(revoke.risks).toEqual([]);
  });

  it('can combine phishing and EOA risks on the same grant', () => {
    const report = generateJsonReport(encodeApprove(PHISH, '64'), {
      bytecodeByAddress: new Map([[`0x${PHISH}`, '0x']]),
    })!;
    expect(report.risks).toEqual([
      PHISHING_SPENDER_RISK,
      APPROVAL_TO_EOA_RISK,
    ]);
  });

  it('honors an explicit address-kind map without bytecode', () => {
    const known = createAddressKindMap([], [`0x${EOA}`]);
    const report = generateJsonReport(encodeApprove(EOA, '1'), {
      addressKinds: known,
    })!;
    expect(report.type).toBe('erc20_approve');
    if (report.type !== 'erc20_approve') return;
    expect(report.payload.spenderKind).toBe('eoa');
    expect(report.risks).toEqual([APPROVAL_TO_EOA_RISK]);
  });
});
