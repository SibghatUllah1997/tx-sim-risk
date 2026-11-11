import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { inject } from 'vitest';

export type CliResult = {
  status: number | null;
  stdout: string;
  stderr: string;
};

export const REPO_ROOT = resolve(__dirname, '..', '..');

/**
 * Run the compiled CLI as a child process. Passing `stdin` pipes it in;
 * otherwise stdin is closed (not a TTY), which matches a script with no input.
 */
export function runCli(args: readonly string[], stdin?: string): CliResult {
  const result = spawnSync(process.execPath, [inject('cliEntry'), ...args], {
    cwd: REPO_ROOT,
    input: stdin ?? '',
    encoding: 'utf8',
    timeout: 20_000,
  });
  if (result.error) throw result.error;
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** Run the CLI with `--json` and parse stdout, failing loudly on bad output. */
export function runCliJson(args: readonly string[], stdin?: string): any {
  const result = runCli([...args, '--json'], stdin);
  if (result.status !== 0) {
    throw new Error(`CLI exited ${result.status}: ${result.stderr}`);
  }
  return JSON.parse(result.stdout);
}
