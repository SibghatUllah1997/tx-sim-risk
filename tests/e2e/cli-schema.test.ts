import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { REPO_ROOT, runCli } from './runCli';

describe('CLI e2e: --schema', () => {
  it('prints the shipped report JSON Schema without needing a payload', () => {
    const { status, stdout, stderr } = runCli(['--schema']);
    expect(status).toBe(0);
    expect(stderr).toBe('');
    const parsed = JSON.parse(stdout);
    expect(parsed.$id).toMatch(/report\.schema\.json$/);
    expect(parsed.oneOf).toBeTruthy();
    const onDisk = readFileSync(
      resolve(REPO_ROOT, 'schema', 'report.schema.json'),
      'utf8'
    );
    expect(stdout).toBe(onDisk);
  });
});
