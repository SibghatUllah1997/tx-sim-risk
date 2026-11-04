import { describe, it, expect } from 'vitest';
import {
  PHISHING_SPENDER_RISK,
  createPhishingIndex,
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

const SEED = 'bad0000000000000000000000000000000000001';
const CLEAN = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

describe('JSON report phishing spender rule', () => {
  it('flags a finite ERC-20 approve to a seed phishing spender', () => {
    const report = generateJsonReport(encodeApprove(SEED, '64'))!;
    expect(report.type).toBe('erc20_approve');
    expect(report.payload.spender).toBe(`0x${SEED}`);
    expect(report.risks).toEqual([PHISHING_SPENDER_RISK]);
  });

  it('keeps unlimited_approval and adds phishing_spender together', () => {
    const report = generateJsonReport(encodeApprove(SEED, 'f'.repeat(64)))!;
    expect(report.risks).toEqual(['unlimited_approval', PHISHING_SPENDER_RISK]);
  });

  it('does not flag a revoke (zero amount) even when the spender is listed', () => {
    const report = generateJsonReport(encodeApprove(SEED, '0'))!;
    expect(report.risks).toEqual([]);
  });

  it('does not flag an approve to an unlisted spender', () => {
    const report = generateJsonReport(encodeApprove(CLEAN, '64'))!;
    expect(report.risks).toEqual([]);
  });

  it('flags increaseAllowance grants to a listed spender', () => {
    const report = generateJsonReport(encodeIncrease(SEED, '2a'))!;
    expect(report.type).toBe('erc20_increaseAllowance');
    expect(report.risks).toEqual([PHISHING_SPENDER_RISK]);
  });

  it('does not flag increaseAllowance with a zero delta', () => {
    const report = generateJsonReport(encodeIncrease(SEED, '0'))!;
    expect(report.risks).toEqual([]);
  });

  it('does not flag decreaseAllowance to a listed spender', () => {
    const report = generateJsonReport(encodeDecrease(SEED, '07'))!;
    expect(report.type).toBe('erc20_decreaseAllowance');
    expect(report.risks).toEqual([]);
  });

  it('flags NFT operator grants to a listed address and skips revocations', () => {
    const grant = generateJsonReport(encodeSetApprovalForAll(SEED, true))!;
    expect(grant.type).toBe('nft_setApprovalForAll');
    expect(grant.risks).toContain(PHISHING_SPENDER_RISK);
    expect(grant.risks).toContain('erc721_approve_all');
    expect(grant.risks).toContain('erc1155_approve_all');

    const revoke = generateJsonReport(encodeSetApprovalForAll(SEED, false))!;
    expect(revoke.risks).toEqual([]);
  });

  it('accepts a custom phishing index via report options', () => {
    const customAddr = 'cccccccccccccccccccccccccccccccccccccccc';
    const index = createPhishingIndex([
      {
        address: `0x${customAddr}`,
        label: 'custom',
        category: 'drainer',
      },
    ]);
    const hit = generateJsonReport(encodeApprove(customAddr, '1'), {
      phishingIndex: index,
    })!;
    expect(hit.risks).toEqual([PHISHING_SPENDER_RISK]);

    const miss = generateJsonReport(encodeApprove(SEED, '1'), {
      phishingIndex: index,
    })!;
    expect(miss.risks).toEqual([]);
  });
});
