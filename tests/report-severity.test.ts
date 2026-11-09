import { describe, it, expect } from 'vitest';
import {
  APPROVAL_TO_EOA_RISK,
  PHISHING_SPENDER_RISK,
  UNLIMITED_APPROVAL_RISK,
} from '../src';
import { generateJsonReport } from '../src/report';

function pad32Bytes(hexNoPrefix: string): string {
  return hexNoPrefix.padStart(64, '0');
}

function encodeApprove(spenderNo0x: string, amountHex: string): string {
  return `0x095ea7b3${pad32Bytes(`000000000000000000000000${spenderNo0x}`)}${pad32Bytes(amountHex)}`;
}

const ROUTER = '7a250d5630b4cf539739df2c5dacb4c659f2488d';
const PHISH = 'bad0000000000000000000000000000000000001';
const EOA = '1111111111111111111111111111111111111111';

describe('JSON report severity field', () => {
  it('is info when a grant has no risk ids', () => {
    const report = generateJsonReport(encodeApprove(ROUTER, '1'))!;
    expect(report.risks).toEqual([]);
    expect(report.severity).toBe('info');
    expect(report.riskDetails).toEqual([]);
  });

  it('is warn for an EOA grant and high for unlimited approval', () => {
    const eoa = generateJsonReport(encodeApprove(EOA, '64'), {
      bytecodeByAddress: new Map([[`0x${EOA}`, '0x']]),
    })!;
    expect(eoa.risks).toEqual([APPROVAL_TO_EOA_RISK]);
    expect(eoa.severity).toBe('warn');
    expect(eoa.riskDetails[0]?.severity).toBe('warn');

    const unlimited = generateJsonReport(
      encodeApprove(ROUTER, 'f'.repeat(64))
    )!;
    expect(unlimited.risks).toEqual([UNLIMITED_APPROVAL_RISK]);
    expect(unlimited.severity).toBe('high');
    expect(unlimited.riskDetails[0]?.severity).toBe('high');
  });

  it('rolls mixed warn and high findings up to high', () => {
    const report = generateJsonReport(encodeApprove(PHISH, '64'), {
      bytecodeByAddress: new Map([[`0x${PHISH}`, '0x']]),
    })!;
    expect(report.risks).toEqual([
      PHISHING_SPENDER_RISK,
      APPROVAL_TO_EOA_RISK,
    ]);
    expect(report.severity).toBe('high');
    expect(report.riskDetails.map((d) => d.severity)).toEqual(['high', 'warn']);
  });
});
