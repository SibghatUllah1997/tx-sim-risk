import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SAMPLE_SPECS } from '../src/samples';
import {
  buildSampleSite,
  renderSampleIndex,
  samplePageFilename,
  writeSampleSite,
} from '../src/pages';

describe('sample gallery renderer', () => {
  it('lists every catalog sample with a relative link', () => {
    const html = renderSampleIndex();
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).not.toContain('<script');
    for (const spec of SAMPLE_SPECS) {
      expect(html).toContain(`href="${samplePageFilename(spec.id)}"`);
      expect(html).toContain(spec.title);
    }
  });

  it('escapes untrusted titles and summaries in the index', () => {
    const html = renderSampleIndex([
      {
        id: 'xss-check',
        title: 'A <b>bold</b> title',
        summary: 'click <img src=x onerror=alert(1)>',
        input: SAMPLE_SPECS[0]!.input,
      },
    ]);
    expect(html).not.toContain('<b>bold</b>');
    expect(html).toContain('A &lt;b&gt;bold&lt;/b&gt; title');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('builds an index plus one standalone page per sample', () => {
    const files = buildSampleSite();
    expect(files[0]?.filename).toBe('index.html');
    expect(files).toHaveLength(SAMPLE_SPECS.length + 1);
    const unlimited = files.find((f) => f.filename === 'unlimited-approval.html');
    expect(unlimited?.html).toContain('All sample reports');
    expect(unlimited?.html).toContain('href="./index.html"');
    expect(unlimited?.html).toContain('unlimited_approval');
    expect(unlimited?.html).not.toContain('<script');
  });
});

describe('writeSampleSite', () => {
  it('writes the gallery and a .nojekyll marker', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tx-sim-risk-pages-'));
    const names = writeSampleSite(dir);
    expect(names).toContain('index.html');
    expect(names).toContain('.nojekyll');
    expect(existsSync(join(dir, '.nojekyll'))).toBe(true);
    const index = readFileSync(join(dir, 'index.html'), 'utf8');
    expect(index).toContain('tx-sim-risk sample reports');
    const page = readFileSync(join(dir, 'phishing-approval.html'), 'utf8');
    expect(page).toContain('phishing_spender');
  });
});
