import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { defaultPackageJsonPath } from './packageInfo';

/** Raw text of the files that each carry a copy of the release version. */
export interface ReleaseSources {
  packageJson: string;
  packageLock: string;
  readme: string;
  releaseNotes: string;
  changelog: string;
}

export interface ReleaseCheckResult {
  version: string | null;
  problems: string[];
}

const SEMVER = /^\d+\.\d+\.\d+$/;

function parseJson(text: string, label: string, problems: string[]): unknown {
  try {
    return JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    problems.push(`${label} is not valid JSON`);
    return null;
  }
}

function field(obj: unknown, ...path: string[]): unknown {
  let cur: unknown = obj;
  for (const key of path) {
    if (typeof cur !== 'object' || cur === null || Array.isArray(cur)) return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

/** Version from the first `# tx-sim-risk vX.Y.Z` heading in the release notes. */
export function releaseNotesVersion(text: string): string | null {
  const m = /^#\s+tx-sim-risk\s+v(\d+\.\d+\.\d+)\s*$/m.exec(text);
  return m ? m[1] : null;
}

/** Version from the `Status: **vX.Y.Z**` line in the README. */
export function readmeStatusVersion(text: string): string | null {
  const m = /^Status:\s+\*\*v(\d+\.\d+\.\d+)\*\*/m.exec(text);
  return m ? m[1] : null;
}

/**
 * Check that every place a release version is written agrees with
 * `package.json`. Returns a list of human-readable problems; an empty
 * list means the tree is ready to tag as `v<version>`.
 */
export function checkReleaseConsistency(src: ReleaseSources): ReleaseCheckResult {
  const problems: string[] = [];

  const pkg = parseJson(src.packageJson, 'package.json', problems);
  const rawVersion = field(pkg, 'version');
  if (pkg !== null && (typeof rawVersion !== 'string' || !SEMVER.test(rawVersion))) {
    problems.push('package.json version is missing or not plain MAJOR.MINOR.PATCH');
  }
  const version = typeof rawVersion === 'string' && SEMVER.test(rawVersion) ? rawVersion : null;
  if (!version) return { version: null, problems };

  const lock = parseJson(src.packageLock, 'package-lock.json', problems);
  if (lock !== null) {
    const top = field(lock, 'version');
    const root = field(lock, 'packages', '', 'version');
    if (top !== version) {
      problems.push(`package-lock.json version is ${String(top)}, expected ${version}`);
    }
    if (root !== version) {
      problems.push(`package-lock.json root package version is ${String(root)}, expected ${version}`);
    }
  }

  const notes = releaseNotesVersion(src.releaseNotes);
  if (notes !== version) {
    problems.push(`docs/RELEASE-NOTES.md leads with ${notes ? `v${notes}` : 'no release heading'}, expected v${version}`);
  }

  const status = readmeStatusVersion(src.readme);
  if (status !== version) {
    problems.push(`README status line says ${status ? `v${status}` : 'nothing'}, expected v${version}`);
  }

  const escaped = version.replace(/\./g, '\\.');
  if (!new RegExp(`\\bv${escaped}\\b`).test(src.changelog)) {
    problems.push(`CHANGELOG.md never mentions v${version}`);
  }

  return { version, problems };
}

/** Read the release sources from the package root next to `package.json`. */
export function readReleaseSources(start: string = __dirname): ReleaseSources {
  const root = dirname(defaultPackageJsonPath(start));
  const read = (rel: string) => readFileSync(join(root, rel), 'utf8');
  return {
    packageJson: read('package.json'),
    packageLock: read('package-lock.json'),
    readme: read('README.md'),
    releaseNotes: read(join('docs', 'RELEASE-NOTES.md')),
    changelog: read('CHANGELOG.md'),
  };
}
