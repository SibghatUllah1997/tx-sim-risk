import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  defaultPackageJsonPath,
  formatPackageIdentity,
  readPackageVersion,
} from '../src/packageInfo';

const MANIFEST = JSON.parse(
  readFileSync(resolve(__dirname, '..', 'package.json'), 'utf8')
) as { name: string; version: string };

describe('packageInfo', () => {
  it('finds this package manifest from src, dist, and a nested cache path', () => {
    const fromSrc = defaultPackageJsonPath(resolve(__dirname, '..', 'src'));
    const fromDist = defaultPackageJsonPath(resolve(__dirname, '..', 'dist'));
    const fromCache = defaultPackageJsonPath(
      resolve(__dirname, '..', 'node_modules', '.cache', 'tx-sim-risk-e2e-test')
    );
    expect(fromSrc).toBe(fromDist);
    expect(fromSrc).toBe(fromCache);
    expect(fromSrc.endsWith('package.json')).toBe(true);
  });

  it('reads the published name and version used by --version', () => {
    expect(MANIFEST.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(readPackageVersion()).toBe(MANIFEST.version);
    expect(formatPackageIdentity()).toBe(
      `${MANIFEST.name} ${MANIFEST.version}`
    );
  });

  it('skips a foreign package.json while walking parents', () => {
    const nested = resolve(__dirname, '..', 'node_modules', 'vitest');
    expect(readPackageVersion(nested)).toBe(MANIFEST.version);
  });
});
