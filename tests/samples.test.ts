import { describe, it, expect } from 'vitest';
import {
  SAMPLE_SPECS,
  reportForSample,
  sampleById,
} from '../src/samples';

describe('sample report catalog', () => {
  it('uses unique, URL-safe ids', () => {
    const ids = SAMPLE_SPECS.map((spec) => spec.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    }
  });

  it('looks up a sample by id and returns undefined for unknown ids', () => {
    expect(sampleById('unlimited-approval')?.title).toMatch(/Unlimited/);
    expect(sampleById('no-such-sample')).toBeUndefined();
  });

  it('decodes every catalog entry to a JSON-serialisable report', () => {
    expect(SAMPLE_SPECS.length).toBeGreaterThanOrEqual(8);
    for (const spec of SAMPLE_SPECS) {
      const report = reportForSample(spec);
      expect(report.type).toBeTruthy();
      expect(['info', 'warn', 'high']).toContain(report.severity);
      expect(() => JSON.stringify(report)).not.toThrow();
    }
  });

  it('covers the high-severity unlimited approval and phishing cases', () => {
    const unlimited = reportForSample(sampleById('unlimited-approval')!);
    expect(unlimited.type).toBe('erc20_approve');
    expect(unlimited.severity).toBe('high');
    expect(unlimited.risks).toContain('unlimited_approval');

    const phishing = reportForSample(sampleById('phishing-approval')!);
    expect(phishing.risks).toContain('phishing_spender');
    expect(phishing.severity).toBe('high');
  });

  it('covers a clean transfer and an EOA-spender heuristic', () => {
    const transfer = reportForSample(sampleById('plain-transfer')!);
    expect(transfer.type).toBe('erc20_transfer');
    expect(transfer.risks).toEqual([]);
    expect(transfer.severity).toBe('info');

    const eoa = reportForSample(sampleById('approval-to-eoa')!);
    expect(eoa.risks).toContain('approval_to_eoa');
    expect(eoa.severity).toBe('warn');
  });

  it('throws when a catalog entry cannot be decoded', () => {
    expect(() =>
      reportForSample({
        id: 'broken',
        title: 'Broken',
        summary: 'Not a real call',
        input: '0xdead',
      })
    ).toThrow(/did not decode/);
  });
});
