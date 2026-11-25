import { describe, it, expect } from 'vitest';
import { runCli, runCliJson } from './runCli';
import {
  MAX_UINT,
  ROUTER,
  approveCalldata,
  transferCalldata,
  zeroExTransformCalldata,
} from './fixtures';
import {
  UNLIMITED_APPROVAL_RISK,
  ZEROEX_HIDDEN_GRANT_RISK,
} from '../../src';

const UNLIMITED_APPROVE = approveCalldata(ROUTER, MAX_UINT);

describe('CLI e2e: 0x Exchange Proxy transformERC20', () => {
  it('prints nested inner risks for an unlimited approve hidden in a transform', () => {
    const { status, stdout, stderr } = runCli([
      zeroExTransformCalldata(UNLIMITED_APPROVE),
    ]);
    expect(status).toBe(0);
    expect(stderr).toBe('');
    expect(stdout).toContain(
      'Detected: 0x Exchange Proxy transformERC20(address,address,uint256,uint256,(uint32,bytes)[])'
    );
    expect(stdout).toContain('Transformations: 1');
    expect(stdout).toContain('Transform [0] nonce=3:');
    expect(stdout).toMatch(
      new RegExp(
        `^Risks: ${UNLIMITED_APPROVAL_RISK}, ${ZEROEX_HIDDEN_GRANT_RISK}$`,
        'm'
      )
    );
  });

  it('emits JSON with the inner report nested under the transformer step', () => {
    const report = runCliJson([
      zeroExTransformCalldata(
        transferCalldata('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '0a')
      ),
    ]);
    expect(report.type).toBe('zeroex');
    expect(report.payload.variant).toBe('transform_erc20');
    expect(report.payload.transformations[0].innerReport.type).toBe(
      'erc20_transfer'
    );
    expect(report.risks).toEqual([]);
    expect(report.severity).toBe('info');
  });

  it('renders HTML that names the nested transformer call without scripts', () => {
    const { status, stdout } = runCli([
      '--html',
      zeroExTransformCalldata(UNLIMITED_APPROVE),
    ]);
    expect(status).toBe(0);
    expect(stdout.startsWith('<!doctype html>')).toBe(true);
    expect(stdout).toContain('<code>zeroex</code>');
    expect(stdout).toContain('<th>variant</th><td>transform_erc20</td>');
    expect(stdout).toContain('transform 0');
    expect(stdout).toContain(UNLIMITED_APPROVAL_RISK);
    expect(stdout).toContain(ZEROEX_HIDDEN_GRANT_RISK);
    expect(stdout).not.toMatch(/<script/i);
  });
});
