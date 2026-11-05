import { describe, it, expect } from 'vitest';
import {
  APPROVAL_TO_EOA_RISK,
  BURN_TO_ZERO_ADDRESS_RISK,
  CALLER_ACCOUNT,
  PHISHING_SPENDER_RISK,
  RISK_REASONS,
  UNLIMITED_APPROVAL_RISK,
} from '../src';
import {
  formatReportFooter,
  generateJsonReport,
} from '../src/report';

function pad32Bytes(hexNoPrefix: string): string {
  return hexNoPrefix.padStart(64, '0');
}

function encodeApprove(spenderNo0x: string, amountHex: string): string {
  return `0x095ea7b3${pad32Bytes(`000000000000000000000000${spenderNo0x}`)}${pad32Bytes(amountHex)}`;
}

function encodeTransfer(toNo0x: string, amountHex: string): string {
  return `0xa9059cbb${pad32Bytes(`000000000000000000000000${toNo0x}`)}${pad32Bytes(amountHex)}`;
}

function encodeSetApprovalForAll(
  operatorNo0x: string,
  approved: boolean
): string {
  return `0xa22cb465${pad32Bytes(`000000000000000000000000${operatorNo0x}`)}${pad32Bytes(approved ? '1' : '0')}`;
}

const ROUTER = '7a250d5630b4cf539739df2c5dacb4c659f2488d';
const PHISH = 'bad0000000000000000000000000000000000001';
const EOA = '1111111111111111111111111111111111111111';

describe('plain-text report footer', () => {
  it('prints spender kind and risks for an approve to a known contract', () => {
    const report = generateJsonReport(encodeApprove(ROUTER, 'f'.repeat(64)))!;
    expect(formatReportFooter(report)).toEqual([
      'Spender kind: contract',
      `Risks: ${UNLIMITED_APPROVAL_RISK}`,
      `Reason: ${UNLIMITED_APPROVAL_RISK}: ${RISK_REASONS[UNLIMITED_APPROVAL_RISK]}`,
      `Allowance (0x${ROUTER}): set to ${((1n << 256n) - 1n).toString()}`,
    ]);
  });

  it('prints phishing and EOA risks together when both apply', () => {
    const report = generateJsonReport(encodeApprove(PHISH, '64'), {
      bytecodeByAddress: new Map([[`0x${PHISH}`, '0x']]),
    })!;
    expect(formatReportFooter(report)).toEqual([
      'Spender kind: eoa',
      `Risks: ${PHISHING_SPENDER_RISK}, ${APPROVAL_TO_EOA_RISK}`,
      `Reason: ${PHISHING_SPENDER_RISK}: ${RISK_REASONS[PHISHING_SPENDER_RISK]}`,
      `Reason: ${APPROVAL_TO_EOA_RISK}: ${RISK_REASONS[APPROVAL_TO_EOA_RISK]}`,
      `Allowance (0x${PHISH}): set to 100`,
    ]);
  });

  it('prints operator kind for NFT grants', () => {
    const report = generateJsonReport(encodeSetApprovalForAll(EOA, true), {
      bytecodeByAddress: new Map([[`0x${EOA}`, '0x']]),
    })!;
    const lines = formatReportFooter(report);
    expect(lines[0]).toBe('Operator kind: eoa');
    expect(lines[1]).toMatch(new RegExp(`^Risks: .*${APPROVAL_TO_EOA_RISK}`));
    expect(lines).toContain(`Operator (0x${EOA}): granted`);
  });

  it('prints only a Risks line for a burn transfer (no spender kind)', () => {
    const report = generateJsonReport(encodeTransfer('0'.repeat(40), '1'))!;
    expect(formatReportFooter(report)).toEqual([
      `Risks: ${BURN_TO_ZERO_ADDRESS_RISK}`,
      `Reason: ${BURN_TO_ZERO_ADDRESS_RISK}: ${RISK_REASONS[BURN_TO_ZERO_ADDRESS_RISK]}`,
      `Balance delta (${CALLER_ACCOUNT}): -1`,
      `Balance delta (0x${'0'.repeat(40)}): +1`,
    ]);
  });

  it('omits the Risks line when there are none', () => {
    const report = generateJsonReport(encodeApprove(ROUTER, '1'))!;
    expect(formatReportFooter(report)).toEqual([
      'Spender kind: contract',
      `Allowance (0x${ROUTER}): set to 1`,
    ]);
  });
});
