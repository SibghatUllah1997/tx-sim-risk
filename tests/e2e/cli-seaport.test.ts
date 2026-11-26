import { describe, it, expect } from 'vitest';
import { runCli, runCliJson } from './runCli';
import {
  MAX_UINT,
  ROUTER,
  approveCalldata,
  seaportAdvancedCalldata,
  transferCalldata,
} from './fixtures';
import {
  SEAPORT_HIDDEN_GRANT_RISK,
  UNLIMITED_APPROVAL_RISK,
} from '../../src';

const UNLIMITED_APPROVE = approveCalldata(ROUTER, MAX_UINT);

describe('CLI e2e: Seaport fulfillAdvancedOrder', () => {
  it('prints nested inner risks for an unlimited approve hidden in extraData', () => {
    const { status, stdout, stderr } = runCli([
      seaportAdvancedCalldata(UNLIMITED_APPROVE),
    ]);
    expect(status).toBe(0);
    expect(stderr).toBe('');
    expect(stdout).toContain('Detected: Seaport fulfillAdvancedOrder(');
    expect(stdout).toContain('Extra data: nested');
    expect(stdout).toContain('Extra data: erc20_approve [high:');
    expect(stdout).toMatch(
      new RegExp(
        `^Risks: ${UNLIMITED_APPROVAL_RISK}, ${SEAPORT_HIDDEN_GRANT_RISK}$`,
        'm'
      )
    );
  });

  it('emits JSON with the inner report nested under extraData', () => {
    const report = runCliJson([
      seaportAdvancedCalldata(
        transferCalldata('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '0a')
      ),
    ]);
    expect(report.type).toBe('seaport');
    expect(report.payload.variant).toBe('fulfill_advanced_order');
    expect(report.payload.extraReport.type).toBe('erc20_transfer');
    expect(report.risks).toEqual([]);
    expect(report.severity).toBe('info');
  });

  it('renders HTML that names the nested extraData call without scripts', () => {
    const { status, stdout } = runCli([
      '--html',
      seaportAdvancedCalldata(UNLIMITED_APPROVE),
    ]);
    expect(status).toBe(0);
    expect(stdout.startsWith('<!doctype html>')).toBe(true);
    expect(stdout).toContain('<code>seaport</code>');
    expect(stdout).toContain('<th>variant</th><td>fulfill_advanced_order</td>');
    expect(stdout).toContain('extra data');
    expect(stdout).toContain(UNLIMITED_APPROVAL_RISK);
    expect(stdout).toContain(SEAPORT_HIDDEN_GRANT_RISK);
    expect(stdout).not.toMatch(/<script/i);
  });
});
