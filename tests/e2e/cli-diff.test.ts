import { describe, it, expect } from 'vitest';
import { runCli } from './runCli';
import { MAX_UINT, ROUTER, approveCalldata, transferCalldata } from './fixtures';
import { UNLIMITED_APPROVAL_RISK } from '../../src';
import { SARIF_VERSION } from '../../src/sarif';

const LIMITED = approveCalldata(ROUTER, '0a');
const UNLIMITED = approveCalldata(ROUTER, MAX_UINT);

describe('CLI e2e: --diff', () => {
  it('prints added risks and amount changes in text mode', () => {
    const { status, stdout, stderr } = runCli(['--diff', LIMITED, UNLIMITED]);
    expect(status).toBe(0);
    expect(stderr).toBe('');
    expect(stdout).toContain('Diff: erc20_approve -> erc20_approve');
    expect(stdout).toContain(`Added risks: ${UNLIMITED_APPROVAL_RISK}`);
    expect(stdout).toMatch(/amount: 10 -> /);
  });

  it('emits a JSON tx_diff for --json --diff', () => {
    const result = runCli(['--diff', LIMITED, UNLIMITED, '--json']);
    expect(result.status).toBe(0);
    const diff = JSON.parse(result.stdout);
    expect(diff.type).toBe('tx_diff');
    expect(diff.addedRisks).toContain(UNLIMITED_APPROVAL_RISK);
    expect(diff.addedAddresses).toEqual([]);
    expect(diff.amountChanges[0].field).toBe('amount');
  });

  it('accepts two --data payloads in order', () => {
    const result = runCli([
      '--diff',
      '--data',
      LIMITED,
      '--data',
      transferCalldata('0'.repeat(40), '1'),
      '--json',
    ]);
    expect(result.status).toBe(0);
    const diff = JSON.parse(result.stdout);
    expect(diff.baseline.type).toBe('erc20_approve');
    expect(diff.candidate.type).toBe('erc20_transfer');
    expect(diff.addedAddresses[0].role).toBe('recipient');
  });

  it('limits --sarif --diff to newly added risks', () => {
    const result = runCli(['--diff', LIMITED, UNLIMITED, '--sarif']);
    expect(result.status).toBe(0);
    const log = JSON.parse(result.stdout);
    expect(log.version).toBe(SARIF_VERSION);
    expect(log.runs[0].results.every((r: { ruleId: string }) => r.ruleId === UNLIMITED_APPROVAL_RISK)).toBe(
      true
    );
  });

  it('renders HTML for --html --diff', () => {
    const { status, stdout } = runCli(['--diff', LIMITED, UNLIMITED, '--html']);
    expect(status).toBe(0);
    expect(stdout.startsWith('<!doctype html>')).toBe(true);
    expect(stdout).toContain('unlimited_approval');
  });

  it('exits 1 when --diff does not get two payloads', () => {
    const { status, stderr } = runCli(['--diff', LIMITED]);
    expect(status).toBe(1);
    expect(stderr).toMatch(/two payloads/);
  });
});
