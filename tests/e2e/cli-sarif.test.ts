import { describe, it, expect } from 'vitest';
import { runCli } from './runCli';
import { MAX_UINT, ROUTER, approveCalldata, transferCalldata } from './fixtures';
import { SARIF_VERSION, DEFAULT_SARIF_URI } from '../../src/sarif';
import { UNLIMITED_APPROVAL_RISK, BURN_TO_ZERO_ADDRESS_RISK } from '../../src';

const UNLIMITED_APPROVE = approveCalldata(ROUTER, MAX_UINT);

function runSarif(args: readonly string[]): {
  status: number | null;
  log: any;
} {
  const result = runCli([...args, '--sarif']);
  if (result.status !== 0) {
    return { status: result.status, log: null };
  }
  return { status: result.status, log: JSON.parse(result.stdout) };
}

describe('CLI e2e: --sarif', () => {
  it('prints a SARIF 2.1.0 log with an error for unlimited approval', () => {
    const { status, log } = runSarif([UNLIMITED_APPROVE]);
    expect(status).toBe(0);
    expect(log.version).toBe(SARIF_VERSION);
    expect(log.runs[0].tool.driver.name).toBe('tx-sim-risk');
    expect(log.runs[0].results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: UNLIMITED_APPROVAL_RISK,
          level: 'error',
        }),
      ])
    );
    expect(
      log.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri
    ).toBe(DEFAULT_SARIF_URI);
  });

  it('honors --sarif-uri so GitHub can annotate a repo file', () => {
    const result = runCli([
      transferCalldata('0'.repeat(40), '1'),
      '--sarif',
      '--sarif-uri',
      'fixtures/burn.hex',
    ]);
    expect(result.status).toBe(0);
    const log = JSON.parse(result.stdout);
    expect(log.runs[0].results[0].ruleId).toBe(BURN_TO_ZERO_ADDRESS_RISK);
    expect(log.runs[0].results[0].level).toBe('warning');
    expect(
      log.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri
    ).toBe('fixtures/burn.hex');
  });

  it('exits 1 when --sarif is given unrecognized input', () => {
    const { status, stdout, stderr } = runCli(['0xdeadbeef', '--sarif']);
    expect(status).toBe(1);
    expect(stdout).toBe('');
    expect(stderr).toMatch(/cannot build a SARIF report/);
  });

  it('wins over --json so CI can request SARIF without dropping the flag', () => {
    const result = runCli([UNLIMITED_APPROVE, '--json', '--sarif']);
    expect(result.status).toBe(0);
    const log = JSON.parse(result.stdout);
    expect(log.version).toBe(SARIF_VERSION);
    expect(log.runs).toBeTruthy();
  });
});
