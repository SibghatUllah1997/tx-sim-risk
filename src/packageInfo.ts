import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const PACKAGE_NAME = 'tx-sim-risk';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function tryReadPackage(path: string): Record<string, unknown> | null {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return null;
  }
  text = text.replace(/^\uFEFF/, '');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isPlainObject(parsed)) return null;
  if (parsed.name !== PACKAGE_NAME) return null;
  return parsed;
}

/**
 * Locate this package's `package.json` by walking parents of `start`.
 * Works from `src/`, `dist/`, and the E2E compile cache under
 * `node_modules/.cache`. Skips other packages' manifests by matching
 * the published name.
 */
export function defaultPackageJsonPath(start: string = __dirname): string {
  let dir = resolve(start);
  for (let i = 0; i < 12; i++) {
    const candidate = join(dir, 'package.json');
    if (existsSync(candidate) && tryReadPackage(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`Could not locate ${PACKAGE_NAME} package.json`);
}

/**
 * Read the version string from this package's manifest. Throws if the
 * file is missing or the version field is empty.
 */
export function readPackageVersion(start: string = __dirname): string {
  const path = defaultPackageJsonPath(start);
  const parsed = tryReadPackage(path);
  if (!parsed) {
    throw new Error(`Could not read ${PACKAGE_NAME} package.json at ${path}`);
  }
  if (typeof parsed.version !== 'string' || !parsed.version.trim()) {
    throw new Error(`${path} is missing a version`);
  }
  return parsed.version.trim();
}

/** One-line identity printed by `tx-sim-risk --version`. */
export function formatPackageIdentity(start: string = __dirname): string {
  return `${PACKAGE_NAME} ${readPackageVersion(start)}`;
}
