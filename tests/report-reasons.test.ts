import { describe, it, expect } from 'vitest';
import {
  APPROVAL_TO_EOA_RISK,
  PHISHING_SPENDER_RISK,
  RISK_REASONS,
  UNLIMITED_APPROVAL_RISK,
  describeRisks,
} from '../src';
import { generateJsonReport } from '../src/report';

function pad32Bytes(hexNoPrefix: string): string {
  return hexNoPrefix.padStart(64, '0');
}

function encodeApprove(spenderNo0x: string, amountHex: string): string {
  return `0x095ea7b3${pad32Bytes(`000000000000000000000000${spenderNo0x}`)}${pad32Bytes(amountHex)}`;
}

function encodeTransfer(toNo0x: string, amountHex: string): string {
  return `0xa9059cbb${pad32Bytes(`000000000000000000000000${toNo0x}`)}${pad32Bytes(amountHex)}`;
}

describe('JSON report risk reason strings', () => {
  it('attaches a reason for each risk id, in the same order', () => {
    const phish = 'bad0000000000000000000000000000000000001';
    const report = generateJsonReport(encodeApprove(phish, 'f'.repeat(64)))!;
    expect(report.risks).toEqual([
      UNLIMITED_APPROVAL_RISK,
      PHISHING_SPENDER_RISK,
    ]);
    expect(report.riskDetails).toEqual(describeRisks(report.risks));
    expect(report.riskDetails[0]).toEqual({
      id: UNLIMITED_APPROVAL_RISK,
      reason: RISK_REASONS[UNLIMITED_APPROVAL_RISK],
      severity: 'high',
    });
  });

  it('uses an empty riskDetails list when there are no risks', () => {
    const router = '7a250d5630b4cf539739df2c5dacb4c659f2488d';
    const report = generateJsonReport(encodeApprove(router, '1'))!;
    expect(report.risks).toEqual([]);
    expect(report.riskDetails).toEqual([]);
  });

  it('explains a burn-to-zero transfer', () => {
    const report = generateJsonReport(encodeTransfer('0'.repeat(40), '1'))!;
    expect(report.riskDetails).toHaveLength(1);
    expect(report.riskDetails[0]!.reason).toMatch(/zero address/i);
  });

  it('explains an EOA approval grant', () => {
    const eoa = '1111111111111111111111111111111111111111';
    const report = generateJsonReport(encodeApprove(eoa, '64'), {
      bytecodeByAddress: new Map([[`0x${eoa}`, '0x']]),
    })!;
    expect(report.risks).toEqual([APPROVAL_TO_EOA_RISK]);
    expect(report.riskDetails[0]!.reason).toMatch(/externally owned account/i);
  });
});
