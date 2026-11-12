#!/usr/bin/env node

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { checkDatasetFile } from './dataset';
import { buildExampleDataset, serializeDataset } from './datasetCases';

/**
 * Write examples/dataset/cases.json (or the path given as argv[2]) and
 * check every case against the current decoders. Exits 1 on any mismatch.
 */
function main(): void {
  const out = resolve(process.argv[2] ?? 'examples/dataset/cases.json');
  const dataset = buildExampleDataset();
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, serializeDataset(dataset));
  const failures = checkDatasetFile(out).filter((r) => r.problems.length > 0);
  for (const f of failures) {
    process.stderr.write(`FAIL ${f.id}: ${f.problems.join('; ')}\n`);
  }
  process.stdout.write(`Wrote ${dataset.cases.length} cases to ${out}\n`);
  if (failures.length > 0) process.exit(1);
}

main();
