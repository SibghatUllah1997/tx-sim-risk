#!/usr/bin/env node
import { checkReleaseConsistency, readReleaseSources } from './releaseCheck';

const { version, problems } = checkReleaseConsistency(readReleaseSources());
if (problems.length > 0) {
  for (const p of problems) console.error(`release: ${p}`);
  process.exit(1);
}
console.log(`release: v${version} is consistent across manifest, lockfile, README, notes, and changelog`);
