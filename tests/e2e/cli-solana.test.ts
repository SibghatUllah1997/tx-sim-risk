import { describe, it, expect } from 'vitest';
import { runCli, runCliJson } from './runCli';
import { SEED_DRAINER_PROGRAM_ID } from '../../src/solana/programs';
import { ROUTER, approveCalldata, solanaDrainerBase64, solanaTransferBase64 } from './fixtures';

describe('CLI e2e: Solana', () => {
  it('prints a skeleton for a base64 legacy transfer with no risks', () => {
    const { base64, payer } = solanaTransferBase64();
    const { status, stdout } = runCli([base64]);
    expect(status).toBe(0);
    expect(stdout).toContain('Detected: Solana transaction (legacy)');
    expect(stdout).toContain(`Fee payer: ${payer}`);
    expect(stdout).toContain('Instructions: 1');
    expect(stdout).not.toMatch(/^Risks:/m);
  });

  it('flags a direct invoke of a listed drainer program in text and JSON', () => {
    const base64 = solanaDrainerBase64();
    const text = runCli([base64]).stdout;
    expect(text).toContain(`invoked seed_drainer_program (drainer): ${SEED_DRAINER_PROGRAM_ID}`);
    expect(text).toMatch(/^Risks: solana_suspicious_cpi$/m);

    const report = runCliJson([base64]);
    expect(report.risks).toEqual(['solana_suspicious_cpi']);
    expect(report.severity).toBe('high');
  });
});

describe('CLI e2e: errors and exit codes', () => {
  it('prints usage and exits 1 when no payload is given', () => {
    const { status, stdout, stderr } = runCli([]);
    expect(status).toBe(1);
    expect(stdout).toBe('');
    expect(stderr).toMatch(/^Usage: tx-sim-risk /);
  });

  it('ignores non-payload stdin and still prints usage', () => {
    expect(runCli([], 'hello world\n').status).toBe(1);
  });

  it('exits 1 with a clear message for a missing --config file', () => {
    const { status, stdout, stderr } = runCli([
      approveCalldata(ROUTER, '10'),
      '--config',
      'does-not-exist.json',
    ]);
    expect(status).toBe(1);
    expect(stdout).toBe('');
    expect(stderr).toMatch(/^Error: Cannot read config does-not-exist\.json/);
  });

  it('exits 1 when --html has nothing to render', () => {
    const { status, stderr } = runCli(['0xdeadbeef', '--html']);
    expect(status).toBe(1);
    expect(stderr).toContain('no supported call found');
  });

  it('exits 1 on a malformed type-2 tx passed to --fees', () => {
    const { status, stderr } = runCli(['0x02ca' + '80'.repeat(10), '--fees']);
    expect(status).toBe(1);
    expect(stderr).toMatch(/^Error: Invalid EIP-1559 transaction/);
  });
});
