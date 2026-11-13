import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CLI_USAGE_LINES } from '../../src/cliOptions';
import { REPO_ROOT, runCli } from './runCli';
import { ROUTER, approveCalldata } from './fixtures';

const MANIFEST = JSON.parse(
  readFileSync(resolve(REPO_ROOT, 'package.json'), 'utf8')
) as { name: string; version: string };

describe('CLI e2e: --help and --version', () => {
  it('prints usage on stdout and exits 0 for --help and -h', () => {
    const help = runCli(['--help']);
    expect(help.status).toBe(0);
    expect(help.stderr).toBe('');
    expect(help.stdout).toBe(`${CLI_USAGE_LINES.join('\n')}\n`);

    const short = runCli(['-h']);
    expect(short.status).toBe(0);
    expect(short.stdout).toBe(help.stdout);
  });

  it('prints the package identity for --version and -V without needing a payload', () => {
    const expected = `${MANIFEST.name} ${MANIFEST.version}\n`;
    expect(runCli(['--version'])).toEqual({
      status: 0,
      stdout: expected,
      stderr: '',
    });
    expect(runCli(['-V'])).toEqual({
      status: 0,
      stdout: expected,
      stderr: '',
    });
  });

  it('prefers --help over a payload so a user can ask for usage mid-command', () => {
    const { status, stdout } = runCli([
      approveCalldata(ROUTER, '10'),
      '--help',
    ]);
    expect(status).toBe(0);
    expect(stdout).toContain('--json');
  });
});

describe('CLI e2e: invalid hex payload', () => {
  it('exits 1 with a clear error for 0x followed by non-hex characters', () => {
    const { status, stdout, stderr } = runCli(['0xzzzz']);
    expect(status).toBe(1);
    expect(stdout).toBe('');
    expect(stderr).toMatch(/^Error: input is not valid hex/);
  });

  it('rejects the same junk through --data', () => {
    const { status, stderr } = runCli(['--data', '0xabc']);
    expect(status).toBe(1);
    expect(stderr).toMatch(/^Error: input is not valid hex/);
  });
});
