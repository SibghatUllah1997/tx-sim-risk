import { describe, it, expect } from 'vitest';
import {
  APPROVAL_TO_EOA_RISK,
  BLOCKLISTED_SPENDER_RISK,
  PHISHING_SPENDER_RISK,
  UNLIMITED_APPROVAL_RISK,
  parseAddressLists,
} from '../src';
import { generateJsonReport } from '../src/report';

function word(hexNoPrefix: string): string {
  return hexNoPrefix.padStart(64, '0');
}

function approve(spenderNo0x: string, amountHex: string): string {
  return `0x095ea7b3${word(`000000000000000000000000${spenderNo0x}`)}${word(amountHex)}`;
}

function increase(spenderNo0x: string, deltaHex: string): string {
  return `0x39509351${word(`000000000000000000000000${spenderNo0x}`)}${word(deltaHex)}`;
}

function setApprovalForAll(operatorNo0x: string, approved: boolean): string {
  return `0xa22cb465${word(`000000000000000000000000${operatorNo0x}`)}${word(approved ? '1' : '0')}`;
}

const EOA = 'cccccccccccccccccccccccccccccccccccccccc';
const SEED_PHISH = 'bad0000000000000000000000000000000000001';
const eoaBytecode = new Map([[`0x${EOA}`, '0x']]);

describe('JSON report with allow/block lists', () => {
  it('flags a grant to a block-listed spender', () => {
    const lists = parseAddressLists({ block: [`0x${EOA}`] });
    const report = generateJsonReport(approve(EOA, '64'), { lists })!;
    expect(report.risks).toContain(BLOCKLISTED_SPENDER_RISK);
    expect(report.riskDetails.map((d) => d.id)).toContain(
      BLOCKLISTED_SPENDER_RISK
    );
  });

  it('flags increaseAllowance and NFT grants to a block-listed address', () => {
    const lists = parseAddressLists({ block: [`0x${EOA}`] });
    const inc = generateJsonReport(increase(EOA, '2a'), { lists })!;
    expect(inc.risks).toContain(BLOCKLISTED_SPENDER_RISK);

    const nft = generateJsonReport(setApprovalForAll(EOA, true), { lists })!;
    expect(nft.risks).toContain(BLOCKLISTED_SPENDER_RISK);
  });

  it('does not flag a revoke to a block-listed spender', () => {
    const lists = parseAddressLists({ block: [`0x${EOA}`] });
    expect(generateJsonReport(approve(EOA, '0'), { lists })!.risks).toEqual([]);
    expect(
      generateJsonReport(setApprovalForAll(EOA, false), { lists })!.risks
    ).toEqual([]);
  });

  it('allow list skips the EOA heuristic', () => {
    const without = generateJsonReport(approve(EOA, '64'), {
      bytecodeByAddress: eoaBytecode,
    })!;
    expect(without.risks).toEqual([APPROVAL_TO_EOA_RISK]);

    const lists = parseAddressLists({ allow: [`0x${EOA}`] });
    const withAllow = generateJsonReport(approve(EOA, '64'), {
      bytecodeByAddress: eoaBytecode,
      lists,
    })!;
    expect(withAllow.risks).toEqual([]);
  });

  it('allow list never hides unlimited_approval', () => {
    const lists = parseAddressLists({ allow: [`0x${EOA}`] });
    const report = generateJsonReport(approve(EOA, 'f'.repeat(64)), { lists })!;
    expect(report.risks).toEqual([UNLIMITED_APPROVAL_RISK]);
  });

  it('allow list never hides a built-in phishing hit', () => {
    const lists = parseAddressLists({ allow: [`0x${SEED_PHISH}`] });
    const report = generateJsonReport(approve(SEED_PHISH, '64'), { lists })!;
    expect(report.risks).toContain(PHISHING_SPENDER_RISK);
  });

  it('block wins over allow for the same address', () => {
    const lists = parseAddressLists({
      allow: [`0x${EOA}`],
      block: [`0x${EOA}`],
    });
    const report = generateJsonReport(approve(EOA, '64'), {
      bytecodeByAddress: eoaBytecode,
      lists,
    })!;
    expect(report.risks).toEqual([
      BLOCKLISTED_SPENDER_RISK,
      APPROVAL_TO_EOA_RISK,
    ]);
  });
});
