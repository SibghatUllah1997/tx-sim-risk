import { describe, it, expect } from 'vitest';
import { readFileSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  SNAPSHOT_CASE_IDS,
  buildExampleSnapshots,
  cliTextForReport,
  renderTerminalSvg,
  writeExampleDocs,
} from '../src/exampleSnapshots';
import { generateJsonReport } from '../src/report';

const DATASET_PATH = resolve(
  __dirname,
  '..',
  'examples',
  'dataset',
  'cases.json'
);
const DOCS_DIR = resolve(__dirname, '..', 'docs', 'examples');

describe('example snapshots', () => {
  it('escapes markup and sizes the SVG to the text', () => {
    const svg = renderTerminalSvg('demo <title>', 'a <b> & c');
    expect(svg).toContain('a &lt;b&gt; &amp; c');
    expect(svg).toContain('demo &lt;title&gt;');
    expect(svg).not.toContain('<b>');
    expect(svg.startsWith('<svg ')).toBe(true);
  });

  it('prints CLI-style headers for an unlimited approve', () => {
    const data =
      '0x095ea7b30000000000000000000000007a250d5630b4cf539739df2c5dacb4c659f2488d' +
      'f'.repeat(64);
    const report = generateJsonReport(data)!;
    const text = cliTextForReport(report);
    expect(text).toContain('Detected: ERC-20 approve(address,uint256)');
    expect(text).toContain('Unlimited approval: yes');
    expect(text).toContain('Severity: high');
  });

  it('builds one snapshot per featured dataset case', () => {
    const snaps = buildExampleSnapshots(DATASET_PATH);
    expect(snaps.map((s) => s.id)).toEqual([...SNAPSHOT_CASE_IDS]);
    for (const snap of snaps) {
      expect(snap.text.length).toBeGreaterThan(40);
      expect(snap.svg).toContain('Detected:');
      expect(snap.svg).toContain(snap.id);
    }
  });

  it('matches the committed docs/examples files (run npm run examples to refresh)', () => {
    const snaps = buildExampleSnapshots(DATASET_PATH);
    for (const snap of snaps) {
      const txt = join(DOCS_DIR, `${snap.id}.txt`);
      const svg = join(DOCS_DIR, `${snap.id}.svg`);
      expect(existsSync(txt), txt).toBe(true);
      expect(existsSync(svg), svg).toBe(true);
      expect(readFileSync(txt, 'utf8')).toBe(snap.text);
      expect(readFileSync(svg, 'utf8')).toBe(snap.svg);
    }
  });
});

describe('writeExampleDocs', () => {
  it('writes txt and svg files for every snapshot id', () => {
    const out = mkdtempSync(join(tmpdir(), 'tx-sim-risk-examples-'));
    const names = writeExampleDocs(DATASET_PATH, out);
    expect(names).toHaveLength(SNAPSHOT_CASE_IDS.length * 2);
    for (const id of SNAPSHOT_CASE_IDS) {
      expect(existsSync(join(out, `${id}.txt`))).toBe(true);
      expect(existsSync(join(out, `${id}.svg`))).toBe(true);
    }
  });
});
