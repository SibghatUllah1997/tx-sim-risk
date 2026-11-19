import { describe, it, expect } from 'vitest';
import { encodeFunctionData, parseAbi, type Hex } from 'viem';
import { diffReports, formatTxDiff } from '../src/diff';
import {
  generateJsonReport,
  generateJsonReportFromAny,
} from '../src/report';
import { MAX_UINT256 } from '../src/evm/hex';
import {
  MULTICALL_BATCHED_GRANT_RISK,
  UNLIMITED_APPROVAL_RISK,
} from '../src';

function word(hexNoPrefix: string): string {
  return hexNoPrefix.padStart(64, '0');
}

function approve(spenderNo0x: string, amountHex: string): string {
  return `0x095ea7b3${word(`000000000000000000000000${spenderNo0x}`)}${word(amountHex)}`;
}

function transfer(toNo0x: string, amountHex: string): string {
  return `0xa9059cbb${word(`000000000000000000000000${toNo0x}`)}${word(amountHex)}`;
}

const ROUTER = '7a250d5630b4cf539739df2c5dacb4c659f2488d';
const OTHER = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

describe('diffReports', () => {
  it('returns empty deltas when the two inputs decode the same way', () => {
    const report = generateJsonReport(approve(ROUTER, '0a'))!;
    const diff = diffReports(report, generateJsonReport(approve(ROUTER, '0a'))!);
    expect(diff.addedRisks).toEqual([]);
    expect(diff.removedRisks).toEqual([]);
    expect(diff.addedAddresses).toEqual([]);
    expect(diff.removedAddresses).toEqual([]);
    expect(diff.amountChanges).toEqual([]);
    expect(diff.baseline.type).toBe('erc20_approve');
    expect(diff.candidate.type).toBe('erc20_approve');
  });

  it('flags a new unlimited-approval risk and the amount jump', () => {
    const baseline = generateJsonReport(approve(ROUTER, '0a'))!;
    const candidate = generateJsonReport(approve(ROUTER, 'f'.repeat(64)))!;
    const diff = diffReports(baseline, candidate);
    expect(diff.addedRisks).toContain(UNLIMITED_APPROVAL_RISK);
    expect(diff.removedRisks).toEqual([]);
    expect(diff.addedAddresses).toEqual([]);
    expect(diff.amountChanges).toEqual([
      {
        field: 'amount',
        before: '10',
        after: MAX_UINT256.toString(),
      },
    ]);
    expect(diff.candidate.severity).toBe('high');
    expect(diff.baseline.severity).toBe('info');
  });

  it('highlights a spender swap between two approvals', () => {
    const baseline = generateJsonReport(approve(ROUTER, '0a'))!;
    const candidate = generateJsonReport(approve(OTHER, '0a'))!;
    const diff = diffReports(baseline, candidate);
    expect(diff.removedAddresses).toEqual([
      { address: `0x${ROUTER}`, role: 'spender' },
    ]);
    expect(diff.addedAddresses).toEqual([
      { address: `0x${OTHER}`, role: 'spender' },
    ]);
  });

  it('treats a transfer replacing an approve as a role change plus risks', () => {
    const baseline = generateJsonReport(approve(ROUTER, 'f'.repeat(64)))!;
    const candidate = generateJsonReport(transfer('0'.repeat(40), '1'))!;
    const diff = diffReports(baseline, candidate);
    expect(diff.baseline.type).toBe('erc20_approve');
    expect(diff.candidate.type).toBe('erc20_transfer');
    expect(diff.removedRisks).toContain(UNLIMITED_APPROVAL_RISK);
    expect(diff.addedRisks).toContain('burn_to_zero_address');
    expect(diff.removedAddresses).toEqual([
      { address: `0x${ROUTER}`, role: 'spender' },
    ]);
    expect(diff.addedAddresses).toEqual([
      { address: `0x${'0'.repeat(40)}`, role: 'recipient' },
    ]);
  });

  it('walks inner multicall calls so a hidden grant shows up as added', () => {
    const erc20 = parseAbi(['function approve(address spender, uint256 value)']);
    const batch = parseAbi(['function multicall(bytes[] data)']);
    const inner = encodeFunctionData({
      abi: erc20,
      functionName: 'approve',
      args: [`0x${ROUTER}`, MAX_UINT256],
    });
    const data = encodeFunctionData({
      abi: batch,
      functionName: 'multicall',
      args: [[inner as Hex]],
    });
    const baseline = generateJsonReport(transfer(OTHER, '01'))!;
    const candidate = generateJsonReportFromAny(data)!;
    const diff = diffReports(baseline, candidate);
    expect(diff.addedRisks).toEqual(
      expect.arrayContaining([UNLIMITED_APPROVAL_RISK, MULTICALL_BATCHED_GRANT_RISK])
    );
    expect(diff.addedAddresses).toContainEqual({
      address: `0x${ROUTER}`,
      role: 'spender',
    });
  });
});

describe('formatTxDiff', () => {
  it('prints a stable summary with (none) for empty sides', () => {
    const baseline = generateJsonReport(approve(ROUTER, '0a'))!;
    const lines = formatTxDiff(diffReports(baseline, baseline));
    expect(lines[0]).toBe('Diff: erc20_approve -> erc20_approve');
    expect(lines).toContain('Added risks: (none)');
    expect(lines).toContain('Amount changes: (none)');
  });
});
