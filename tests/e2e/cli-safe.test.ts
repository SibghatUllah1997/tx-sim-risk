import { describe, it, expect } from 'vitest';
import { runCli, runCliJson } from './runCli';
import {
  MAX_UINT,
  ROUTER,
  approveCalldata,
  safeExecCalldata,
  transferCalldata,
} from './fixtures';
import {
  SAFE_DELEGATECALL_RISK,
  SAFE_HIDDEN_GRANT_RISK,
  UNLIMITED_APPROVAL_RISK,
} from '../../src';

const UNLIMITED_APPROVE = approveCalldata(ROUTER, MAX_UINT);

describe('CLI e2e: Safe execTransaction', () => {
  it('prints nested inner risks for an unlimited approve hidden in a Safe tx', () => {
    const { status, stdout, stderr } = runCli([
      safeExecCalldata(UNLIMITED_APPROVE),
    ]);
    expect(status).toBe(0);
    expect(stderr).toBe('');
    expect(stdout).toContain('Detected: Safe execTransaction(');
    expect(stdout).toContain('Operation: call');
    expect(stdout).toContain('Inner: erc20_approve');
    expect(stdout).toMatch(
      new RegExp(`^Risks: ${UNLIMITED_APPROVAL_RISK}, ${SAFE_HIDDEN_GRANT_RISK}$`, 'm')
    );
  });

  it('emits JSON with the inner report nested under payload', () => {
    const report = runCliJson([
      safeExecCalldata(transferCalldata('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '0a')),
    ]);
    expect(report.type).toBe('safe_exec');
    expect(report.payload.operation).toBe('call');
    expect(report.payload.innerReport.type).toBe('erc20_transfer');
    expect(report.risks).toEqual([]);
    expect(report.severity).toBe('info');
  });

  it('renders HTML that names the inner call without scripts', () => {
    const { status, stdout } = runCli([
      '--html',
      safeExecCalldata(UNLIMITED_APPROVE),
    ]);
    expect(status).toBe(0);
    expect(stdout.startsWith('<!doctype html>')).toBe(true);
    expect(stdout).toContain('<code>safe_exec</code>');
    expect(stdout).toContain(UNLIMITED_APPROVAL_RISK);
    expect(stdout).toContain(SAFE_HIDDEN_GRANT_RISK);
    expect(stdout).not.toMatch(/<script/i);
  });

  it('flags DelegateCall in JSON', () => {
    const report = runCliJson([safeExecCalldata('0x', 1)]);
    expect(report.type).toBe('safe_exec');
    expect(report.payload.operation).toBe('delegatecall');
    expect(report.risks).toContain(SAFE_DELEGATECALL_RISK);
    expect(report.severity).toBe('high');
  });
});
