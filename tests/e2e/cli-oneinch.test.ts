import { describe, it, expect } from 'vitest';
import { runCli, runCliJson } from './runCli';
import {
  MAX_UINT,
  ROUTER,
  approveCalldata,
  oneInchSwapCalldata,
  transferCalldata,
} from './fixtures';
import {
  ONEINCH_HIDDEN_GRANT_RISK,
  UNLIMITED_APPROVAL_RISK,
} from '../../src';

const UNLIMITED_APPROVE = approveCalldata(ROUTER, MAX_UINT);

describe('CLI e2e: 1inch Aggregation Router swap', () => {
  it('prints nested inner risks for an unlimited approve hidden in swap', () => {
    const { status, stdout, stderr } = runCli([
      oneInchSwapCalldata(UNLIMITED_APPROVE),
    ]);
    expect(status).toBe(0);
    expect(stderr).toBe('');
    expect(stdout).toContain(
      'Detected: 1inch Aggregation Router swap(address,(address,address,address,address,uint256,uint256,uint256),bytes,bytes)'
    );
    expect(stdout).toContain('Executor data: nested');
    expect(stdout).toContain('Executor 0x');
    expect(stdout).toMatch(
      new RegExp(
        `^Risks: ${UNLIMITED_APPROVAL_RISK}, ${ONEINCH_HIDDEN_GRANT_RISK}$`,
        'm'
      )
    );
  });

  it('emits JSON with the inner report nested under executor data', () => {
    const report = runCliJson([
      oneInchSwapCalldata(
        transferCalldata('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '0a')
      ),
    ]);
    expect(report.type).toBe('oneinch');
    expect(report.payload.variant).toBe('swap');
    expect(report.payload.executorReport.type).toBe('erc20_transfer');
    expect(report.risks).toEqual([]);
    expect(report.severity).toBe('info');
  });

  it('renders HTML that names the nested executor call without scripts', () => {
    const { status, stdout } = runCli([
      '--html',
      oneInchSwapCalldata(UNLIMITED_APPROVE),
    ]);
    expect(status).toBe(0);
    expect(stdout.startsWith('<!doctype html>')).toBe(true);
    expect(stdout).toContain('<code>oneinch</code>');
    expect(stdout).toContain('<th>variant</th><td>swap</td>');
    expect(stdout).toContain('executor data');
    expect(stdout).toContain(UNLIMITED_APPROVAL_RISK);
    expect(stdout).toContain(ONEINCH_HIDDEN_GRANT_RISK);
    expect(stdout).not.toMatch(/<script/i);
  });
});
