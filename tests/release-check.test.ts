import { describe, it, expect } from 'vitest';
import {
  checkReleaseConsistency,
  readmeStatusVersion,
  readReleaseSources,
  releaseNotesVersion,
  type ReleaseSources,
} from '../src/releaseCheck';

function sources(version: string, overrides: Partial<ReleaseSources> = {}): ReleaseSources {
  return {
    packageJson: JSON.stringify({ name: 'tx-sim-risk', version }),
    packageLock: JSON.stringify({
      name: 'tx-sim-risk',
      version,
      packages: { '': { name: 'tx-sim-risk', version } },
    }),
    readme: `# tx-sim-risk\n\nStatus: **v${version}**. See notes.\n`,
    releaseNotes: `# tx-sim-risk v${version}\n\nStuff.\n\n# tx-sim-risk v0.0.1\n`,
    changelog: `## 2026-11-20\n\n- Released v${version}.\n`,
    ...overrides,
  };
}

describe('release version helpers', () => {
  it('reads the first release heading only', () => {
    expect(releaseNotesVersion('# tx-sim-risk v0.2.0\n\n# tx-sim-risk v0.1.0\n')).toBe('0.2.0');
    expect(releaseNotesVersion('## tx-sim-risk v0.2.0\n')).toBeNull();
    expect(releaseNotesVersion('# tx-sim-risk v0.2\n')).toBeNull();
  });

  it('reads the README status line', () => {
    expect(readmeStatusVersion('intro\nStatus: **v1.2.3**. more\n')).toBe('1.2.3');
    expect(readmeStatusVersion('Status: v1.2.3\n')).toBeNull();
  });
});

describe('checkReleaseConsistency', () => {
  it('passes when every copy agrees', () => {
    expect(checkReleaseConsistency(sources('0.2.0'))).toEqual({ version: '0.2.0', problems: [] });
  });

  it('flags a lockfile left on an older version, top level and root package separately', () => {
    const lock = JSON.stringify({ version: '1.0.0', packages: { '': { version: '0.2.0' } } });
    const { problems } = checkReleaseConsistency(sources('0.2.0', { packageLock: lock }));
    expect(problems).toEqual(['package-lock.json version is 1.0.0, expected 0.2.0']);

    const noRoot = JSON.stringify({ version: '0.2.0', packages: {} });
    expect(checkReleaseConsistency(sources('0.2.0', { packageLock: noRoot })).problems).toEqual([
      'package-lock.json root package version is undefined, expected 0.2.0',
    ]);
  });

  it('flags stale release notes, README, and changelog', () => {
    const { problems } = checkReleaseConsistency(
      sources('0.2.0', {
        releaseNotes: '# tx-sim-risk v0.1.0\n',
        readme: 'no status here\n',
        changelog: '## 2026-11-20\n\n- Released v0.2.01 by mistake.\n',
      })
    );
    expect(problems).toEqual([
      'docs/RELEASE-NOTES.md leads with v0.1.0, expected v0.2.0',
      'README status line says nothing, expected v0.2.0',
      'CHANGELOG.md never mentions v0.2.0',
    ]);
  });

  it('does not let a dotted version match loosely in the changelog', () => {
    const { problems } = checkReleaseConsistency(
      sources('0.2.0', { changelog: '- Released v0x2x0.\n' })
    );
    expect(problems).toEqual(['CHANGELOG.md never mentions v0.2.0']);
  });

  it('stops early on a broken or non-semver manifest', () => {
    expect(checkReleaseConsistency(sources('0.2.0', { packageJson: '{' }))).toEqual({
      version: null,
      problems: ['package.json is not valid JSON'],
    });
    expect(
      checkReleaseConsistency(sources('0.2.0', { packageJson: '{"version":"0.2.0-rc.1"}' }))
    ).toEqual({
      version: null,
      problems: ['package.json version is missing or not plain MAJOR.MINOR.PATCH'],
    });
  });

  it('reports an unparsable lockfile instead of throwing', () => {
    const { problems } = checkReleaseConsistency(sources('0.2.0', { packageLock: 'nope' }));
    expect(problems).toEqual(['package-lock.json is not valid JSON']);
  });
});

describe('this repository', () => {
  it('is consistent and ready to tag', () => {
    const result = checkReleaseConsistency(readReleaseSources());
    expect(result.problems).toEqual([]);
    expect(result.version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
