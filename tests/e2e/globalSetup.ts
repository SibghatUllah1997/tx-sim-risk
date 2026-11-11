import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    cliEntry: string;
  }
}

/**
 * Compile the CLI once into a throwaway directory so E2E tests exercise the
 * real `node dist/cli.js` path without depending on (or clobbering) a local
 * `dist/` that may be stale. The directory sits under node_modules/.cache so
 * the compiled files still resolve runtime dependencies from node_modules.
 */
export default function setup(project: TestProject): () => void {
  const root = resolve(__dirname, '..', '..');
  const cacheDir = join(root, 'node_modules', '.cache');
  mkdirSync(cacheDir, { recursive: true });
  const outDir = mkdtempSync(join(cacheDir, 'tx-sim-risk-e2e-'));
  const tsc = join(root, 'node_modules', '.bin', 'tsc');
  execFileSync(tsc, ['-p', join(root, 'tsconfig.json'), '--outDir', outDir], {
    cwd: root,
    stdio: 'pipe',
  });
  project.provide('cliEntry', join(outDir, 'cli.js'));
  return () => rmSync(outDir, { recursive: true, force: true });
}
