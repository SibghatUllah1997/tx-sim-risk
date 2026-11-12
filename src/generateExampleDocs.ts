#!/usr/bin/env node

import { resolve } from 'node:path';
import { writeExampleDocs } from './exampleSnapshots';

/**
 * Write docs/examples/*.txt and *.svg for the README screenshots.
 * Paths default to the files committed next to this repository.
 */
function main(): void {
  const dataset = resolve(process.argv[2] ?? 'examples/dataset/cases.json');
  const outDir = resolve(process.argv[3] ?? 'docs/examples');
  const names = writeExampleDocs(dataset, outDir);
  process.stdout.write(`Wrote ${names.length} files to ${outDir}\n`);
}

main();
