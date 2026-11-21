import { describe, it, expect } from 'vitest';
import { runCli, runCliJson } from './runCli';
import {
  RECIPIENT,
  ROUTER,
  universalRouterPermitCalldata,
  universalRouterUnwrapCalldata,
} from './fixtures';
import {
  UNIVERSAL_ROUTER_HIDDEN_GRANT_RISK,
  UNLIMITED_PERMIT_RISK,
} from '../../src';

const MAX_UINT160 = (1n << 160n) - 1n;

describe('CLI e2e: Universal Router execute', () => {
  it('prints nested Permit2 risks for an unlimited grant hidden in execute', () => {
    const { status, stdout, stderr } = runCli([
      universalRouterPermitCalldata(ROUTER, MAX_UINT160),
    ]);
    expect(status).toBe(0);
    expect(stderr).toBe('');
    expect(stdout).toContain(
      'Detected: Uniswap Universal Router execute(bytes,bytes[])'
    );
    expect(stdout).toContain('Commands: 1');
    expect(stdout).toContain('  [0] permit2_permit');
    expect(stdout).toMatch(
      new RegExp(
        `^Risks: ${UNLIMITED_PERMIT_RISK}, ${UNIVERSAL_ROUTER_HIDDEN_GRANT_RISK}$`,
        'm'
      )
    );
  });

  it('emits JSON with inner Permit2 nested under the command', () => {
    const report = runCliJson([universalRouterUnwrapCalldata(RECIPIENT)]);
    expect(report.type).toBe('universal_router');
    expect(report.payload.commands).toHaveLength(1);
    expect(report.payload.commands[0].kind).toBe('unwrap_weth');
    expect(report.payload.commands[0].innerReport).toBeNull();
    expect(report.risks).toEqual([]);
    expect(report.severity).toBe('info');
  });

  it('renders HTML that names the command without scripts', () => {
    const { status, stdout } = runCli([
      '--html',
      universalRouterPermitCalldata(ROUTER, MAX_UINT160),
    ]);
    expect(status).toBe(0);
    expect(stdout.startsWith('<!doctype html>')).toBe(true);
    expect(stdout).toContain('<code>universal_router</code>');
    expect(stdout).toContain('permit2_permit');
    expect(stdout).toContain(UNLIMITED_PERMIT_RISK);
    expect(stdout).toContain(UNIVERSAL_ROUTER_HIDDEN_GRANT_RISK);
    expect(stdout).not.toMatch(/<script/i);
  });
});
