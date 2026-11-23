import { describe, it, expect } from 'vitest';
import { runCli, runCliJson } from './runCli';
import {
  MAX_UINT,
  ROUTER,
  approveCalldata,
  cowswapSettleCalldata,
  transferCalldata,
} from './fixtures';
import {
  COWSWAP_HIDDEN_GRANT_RISK,
  UNLIMITED_APPROVAL_RISK,
} from '../../src';

const UNLIMITED_APPROVE = approveCalldata(ROUTER, MAX_UINT);

describe('CLI e2e: CowSwap settle', () => {
  it('prints nested inner risks for an unlimited approve hidden in settle', () => {
    const { status, stdout, stderr } = runCli([
      cowswapSettleCalldata(UNLIMITED_APPROVE),
    ]);
    expect(status).toBe(0);
    expect(stderr).toBe('');
    expect(stdout).toContain('Detected: CowSwap settle(');
    expect(stdout).toContain('Trades: 1');
    expect(stdout).toContain('Interactions: 1');
    expect(stdout).toContain('  interaction [0] pre target=');
    expect(stdout).toMatch(
      new RegExp(
        `^Risks: ${UNLIMITED_APPROVAL_RISK}, ${COWSWAP_HIDDEN_GRANT_RISK}$`,
        'm'
      )
    );
  });

  it('emits JSON with the inner report nested under the interaction', () => {
    const report = runCliJson([
      cowswapSettleCalldata(
        transferCalldata('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '0a')
      ),
    ]);
    expect(report.type).toBe('cowswap');
    expect(report.payload.variant).toBe('settle');
    expect(report.payload.interactions).toHaveLength(1);
    expect(report.payload.interactions[0].stage).toBe('pre');
    expect(report.payload.interactions[0].innerReport.type).toBe(
      'erc20_transfer'
    );
    expect(report.risks).toEqual([]);
    expect(report.severity).toBe('info');
  });

  it('renders HTML that names the interaction without scripts', () => {
    const { status, stdout } = runCli([
      '--html',
      cowswapSettleCalldata(UNLIMITED_APPROVE),
    ]);
    expect(status).toBe(0);
    expect(stdout.startsWith('<!doctype html>')).toBe(true);
    expect(stdout).toContain('<code>cowswap</code>');
    expect(stdout).toContain('pre target=');
    expect(stdout).toContain(UNLIMITED_APPROVAL_RISK);
    expect(stdout).toContain(COWSWAP_HIDDEN_GRANT_RISK);
    expect(stdout).not.toMatch(/<script/i);
  });
});
