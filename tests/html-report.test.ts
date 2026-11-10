import { describe, it, expect } from 'vitest';
import { escapeHtml, renderHtmlReport } from '../src/html';
import { generateJsonReport, type JsonReport } from '../src/report';

function pad32(hexNoPrefix: string): string {
  return hexNoPrefix.padStart(64, '0');
}

function encodeApprove(spenderNo0x: string, amountHex: string): string {
  return `0x095ea7b3${pad32(`000000000000000000000000${spenderNo0x}`)}${pad32(amountHex)}`;
}

const ROUTER = '7a250d5630b4cf539739df2c5dacb4c659f2488d';

describe('escapeHtml', () => {
  it('escapes all five HTML-special characters', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;'
    );
  });
});

describe('renderHtmlReport', () => {
  it('renders a standalone page with severity, risks and details', () => {
    const report = generateJsonReport(encodeApprove(ROUTER, 'f'.repeat(64)))!;
    const html = renderHtmlReport(report);
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<code>erc20_approve</code>');
    expect(html).toContain('sev-high');
    expect(html).toContain('<code>unlimited_approval</code>');
    expect(html).toContain(`0x${ROUTER}`.slice(0, 10));
    expect(html).not.toContain('<script');
  });

  it('says so when there are no risks', () => {
    const report = generateJsonReport(encodeApprove(ROUTER, '1'))!;
    const html = renderHtmlReport(report);
    expect(html).toContain('No risks found.');
    expect(html).toContain('sev-info');
  });

  it('escapes untrusted values from the report', () => {
    const report = generateJsonReport(encodeApprove(ROUTER, '1'))!;
    const tampered = {
      ...report,
      simulation: { ...report.simulation, notes: ['<img src=x onerror=alert(1)>'] },
    } as JsonReport;
    const html = renderHtmlReport(tampered, 'T <b>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('<title>T &lt;b&gt;</title>');
  });

  it('inserts trusted preamble markup at the top of the body', () => {
    const report = generateJsonReport(encodeApprove(ROUTER, '1'))!;
    const html = renderHtmlReport(report, 'Preamble', {
      preambleHtml: '<p><a href="./index.html">back</a></p>',
    });
    expect(html).toMatch(/<body>\s*<p><a href="\.\/index.html">back<\/a><\/p>\s*<h1>/);
  });
});
