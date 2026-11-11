import { describe, it, expect } from 'vitest';
import { runCli, runCliJson } from './runCli';
import {
  BLOCKED,
  MAX_UINT,
  RECIPIENT,
  ROUTER,
  SENDER,
  approveCalldata,
  eip1559RawTx,
  legacyRawTx,
  setApprovalForAllCalldata,
  transferCalldata,
} from './fixtures';

const UNLIMITED_APPROVE = approveCalldata(ROUTER, MAX_UINT);

describe('CLI e2e: EVM calldata', () => {
  it('prints a text analysis with risks and reasons for an unlimited approve', () => {
    const { status, stdout, stderr } = runCli([UNLIMITED_APPROVE]);
    expect(status).toBe(0);
    expect(stderr).toBe('');
    expect(stdout).toContain('Detected: ERC-20 approve(address,uint256)');
    expect(stdout).toContain(`Spender: 0x${ROUTER}`);
    expect(stdout).toContain('Unlimited approval: yes');
    expect(stdout).toContain('Severity: high');
    expect(stdout).toMatch(/^Risks: unlimited_approval$/m);
    expect(stdout).toMatch(/^Reason: unlimited_approval \[high\]: /m);
  });

  it('reads the same payload from --data, --data=, and stdin', () => {
    const positional = runCli([UNLIMITED_APPROVE]).stdout;
    expect(runCli(['--data', UNLIMITED_APPROVE]).stdout).toBe(positional);
    expect(runCli([`--data=${UNLIMITED_APPROVE}`]).stdout).toBe(positional);
    expect(runCli([], `${UNLIMITED_APPROVE}\n`).stdout).toBe(positional);
  });

  it('emits a parseable JSON report with simulation deltas', () => {
    const report = runCliJson([transferCalldata(RECIPIENT, '64'), '--from', SENDER]);
    expect(report.type).toBe('erc20_transfer');
    expect(report.payload.amount).toBe('100');
    expect(report.risks).toEqual([]);
    expect(report.simulation.balances).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ account: SENDER }),
        expect.objectContaining({ account: `0x${RECIPIENT}` }),
      ])
    );
  });

  it('flags a burn transfer with a warn severity', () => {
    const report = runCliJson([transferCalldata('0'.repeat(40), '1')]);
    expect(report.risks).toEqual(['burn_to_zero_address']);
    expect(report.severity).toBe('warn');
  });

  it('reports both NFT approve-all risks for setApprovalForAll(true)', () => {
    const { status, stdout } = runCli([setApprovalForAllCalldata(ROUTER, true)]);
    expect(status).toBe(0);
    expect(stdout).toContain('ERC-721 approve-all: yes');
    expect(stdout).toContain('ERC-1155 approve-all: yes');
    expect(stdout).toMatch(/^Risks: erc721_approve_all, erc1155_approve_all$/m);
  });

  it('applies --config block lists end to end', () => {
    const args = [approveCalldata(BLOCKED, '10'), '--config', 'examples/risk-lists.json'];
    const report = runCliJson(args);
    expect(report.risks).toContain('blocklisted_spender');
    expect(report.severity).toBe('high');
    expect(runCli(args).stdout).toMatch(/^Reason: blocklisted_spender \[high\]: /m);
  });

  it('renders a standalone HTML page from stdin', () => {
    const { status, stdout } = runCli(['--html'], UNLIMITED_APPROVE);
    expect(status).toBe(0);
    expect(stdout.startsWith('<!doctype html>')).toBe(true);
    expect(stdout).toContain('unlimited_approval');
    expect(stdout).not.toMatch(/<script/i);
  });

  it('prints an unknown-call notice (text) and an empty report (JSON)', () => {
    expect(runCli(['0xdeadbeef']).stdout.trim()).toBe(
      'Unsupported or unknown transaction data for current decoders.'
    );
    expect(runCliJson(['0xdeadbeef'])).toEqual({ type: 'unknown', risks: [], payload: {} });
  });
});

describe('CLI e2e: raw transactions', () => {
  it('prints EIP-1559 fees and chain id for an unsigned type-2 tx', () => {
    const raw = eip1559RawTx(UNLIMITED_APPROVE, 137);
    const { status, stdout, stderr } = runCli([raw, '--fees', '--chainId']);
    expect(stderr).toBe('');
    expect(status).toBe(0);
    expect(stdout.trim().split('\n')).toEqual([
      'Detected: EIP-1559 raw transaction',
      'Gas limit: 60000',
      'Max priority fee per gas: 2000000000 wei',
      'Max fee per gas: 30000000000 wei',
      'Chain ID: 137',
    ]);
  });

  it('unwraps calldata from a type-2 tx and analyses it', () => {
    const report = runCliJson([eip1559RawTx(UNLIMITED_APPROVE)]);
    expect(report.type).toBe('erc20_approve');
    expect(report.risks).toContain('unlimited_approval');
  });

  it('reads the EIP-155 chain id from a signed legacy tx', () => {
    const { status, stdout } = runCli([legacyRawTx(approveCalldata(ROUTER, '10'), 56), '--chainId']);
    expect(status).toBe(0);
    const lines = stdout.split('\n');
    expect(lines[0]).toBe('Chain ID: 56');
    expect(lines[1]).toBe('Detected: ERC-20 approve(address,uint256)');
  });

  it('says so when --fees is given a non-1559 tx', () => {
    const { status, stdout } = runCli([legacyRawTx(approveCalldata(ROUTER, '10'), 1), '--fees']);
    expect(status).toBe(0);
    expect(stdout.trim()).toBe('No EIP-1559 fee fields found in input.');
  });
});
