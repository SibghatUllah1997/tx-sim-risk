#!/usr/bin/env node

import { resolve } from 'node:path';
import { writeSampleSite } from './pages';

function main(): void {
  const outDir = resolve(process.argv[2] ?? 'site');
  const written = writeSampleSite(outDir);
  process.stdout.write(`Wrote ${written.length} files to ${outDir}\n`);
}

main();
