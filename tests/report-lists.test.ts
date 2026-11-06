import { describe, it, expect } from 'vitest';
import {
  APPROVAL_TO_EOA_RISK,
  BLOCKLISTED_SPENDER_RISK,
  PHISHING_SPENDER_RISK,
  UNLIMITED_APPROVAL_RISK,
  parseRiskListConfig,
} from '../src';
import { generateJsonReport } from '../src/report';

function word(hexNoPrefix: string): string {
  return hexNoPrefix.padStart(64, '0');
}

function approve(spenderNo0x: string, amountHex: string): string {
  return `0x095ea7b3${word(spenderNo0x)}${word(amountHex)}`;
}

function setApprovalForAll(operatorNo0x: string, approved: boolean): string {
  return `0xa22cb465${word(operatorNo0x)}${word(approved ? '1' : '0')}`;
}

const EOA = 'cccccccccccccccccccccccccccccccccccccccc';
const SEED_PHISH = 'bad0000000000000000000000000000000000001';
const eoaBytecode = new Map([[`0x${EOA}`, '0x']]);

describe('JSON report with allow/block lists', () => {
  it('flags a grant to a block-listed spender', () => {
    const lists = parseRiskListConfig({ block: [`0x${EOA}`] });
    const report = generateJsonReport(approve(EOA, '64'), { lists })!;
    expect(report.risks).toContain(BLOCKLISTED_SPENDER_RISK);
    expect(report.riskDetails.map((d) => d.id)).toContain(
      BLOCKLISTED_SPENDER_RISK
    );
  });

  it('flags NFT operator grants to a block-listed operator', () => {
    const lists = parseRiskListConfig({ block: [`0x${EOA}`] });
    const report = generateJsonReport(setApprovalForAll(EOA, true), { lists })!;
    expect(report.risks).toContain(BLOCKLISTED_SPENDER_RISK);
  });

  it('does not flag a revoke to a block-listed spender', () => {
    const lists = parseRiskListConfig({ block: [`0x${EOA}`] });
    const report = generateJsonReport(approve(EOA, '0'), { lists })!;
    expect(report.risks).toEqual([]);
  });

  it('allow list skips the EOA heuristic', () => {
    const without = generateJsonReport(approve(EOA, '64'), {
      bytecodeByAddress: eoaBytecode,
    })!;
    expect(without.risks).toEqual([APPROVAL_TO_EOA_RISK]);

    const lists = parseRiskListConfig({ allow: [`0x${EOA}`] });
    const withAllow = generateJsonReport(approve(EOA, '64'), {
      bytecodeByAddress: eoaBytecode,
      lists,
    })!;
    expect(withAllow.risks).toEqual([]);
  });

  it('allow list never hides unlimited_approval', () => {
    const lists = parseRiskListConfig({ allow: [`0x${EOA}`] });
    const report = generateJsonReport(approve(EOA, 'f'.repeat(64)), { lists })!;
    expect(report.risks).toEqual([UNLIMITED_APPROVAL_RISK]);
  });

  it('allow list never hides a built-in phishing hit', () => {
    const lists = parseRiskListConfig({ allow: [`0x${SEED_PHISH}`] });
    const report = generateJsonReport(approve(SEED_PHISH, '64'), { lists })!;
    expect(report.risks).toContain(PHISHING_SPENDER_RISK);
  });

  it('block wins over allow for the same address', () => {
    const lists = parseRiskListConfig({
      allow: [`0x${EOA}`],
      block: [`0x${EOA}`],
    });
    const report = generateJsonReport(approve(EOA, '64'), {
      bytecodeByAddress: eoaBytecode,
      lists,
    })!;
    expect(report.risks).toEqual([BLOCKLISTED_SPENDER_RISK, APPROVAL_TO_EOA_RISK]);
  });
});
