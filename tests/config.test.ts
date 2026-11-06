import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BLOCKLISTED_SPENDER_RISK,
  blocklistRisks,
  isAllowlisted,
  isBlocklisted,
  loadRiskListConfig,
  parseRiskListConfig,
} from '../src';

const A = '0xAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAa';
const B = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

describe('parseRiskListConfig', () => {
  it('normalizes addresses to lowercase 0x keys', () => {
    const lists = parseRiskListConfig({ allow: [A], block: [B] });
    expect([...lists.allow]).toEqual([A.toLowerCase()]);
    expect(lists.block.get(B)).toBe(B);
  });

  it('accepts labeled block entries and missing fields', () => {
    const lists = parseRiskListConfig({
      block: [{ address: B, label: 'old-router' }],
    });
    expect(lists.allow.size).toBe(0);
    expect(lists.block.get(B)).toBe('old-router');
  });

  it('accepts an address without the 0x prefix', () => {
    const lists = parseRiskListConfig({ block: [B.slice(2)] });
    expect(isBlocklisted(B, lists)).toBe(true);
  });

  it.each([
    [null, /JSON object/],
    [[], /JSON object/],
    [{ allow: 'x' }, /"allow" must be an array/],
    [{ allow: ['0x123'] }, /allow\[0\]: invalid address/],
    [{ block: [{ label: 'no address' }] }, /block\[0\]\.address/],
    [{ block: [{ address: B, label: 7 }] }, /block\[0\]\.label/],
    [{ allowlist: [A] }, /Unknown config field\(s\): allowlist/],
  ])('rejects bad config %j', (input, message) => {
    expect(() => parseRiskListConfig(input)).toThrow(message);
  });
});

describe('allow/block matching', () => {
  const lists = parseRiskListConfig({ allow: [A, B], block: [B] });

  it('block wins when an address is on both lists', () => {
    expect(isBlocklisted(B, lists)).toBe(true);
    expect(isAllowlisted(B, lists)).toBe(false);
  });

  it('matches allow-listed addresses case-insensitively', () => {
    expect(isAllowlisted(A.toLowerCase(), lists)).toBe(true);
  });

  it('emits blocklisted_spender only for block-listed addresses', () => {
    expect(blocklistRisks(B, lists)).toEqual([BLOCKLISTED_SPENDER_RISK]);
    expect(blocklistRisks(A, lists)).toEqual([]);
    expect(blocklistRisks('not-an-address', lists)).toEqual([]);
  });

  it('matches nothing without a config', () => {
    expect(isBlocklisted(B)).toBe(false);
    expect(isAllowlisted(A)).toBe(false);
  });
});

describe('loadRiskListConfig', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tx-sim-risk-'));

  it('loads a JSON file from disk', () => {
    const path = join(dir, 'lists.json');
    writeFileSync(path, JSON.stringify({ block: [B] }));
    expect(isBlocklisted(B, loadRiskListConfig(path))).toBe(true);
  });

  it('reports invalid JSON with the file path', () => {
    const path = join(dir, 'broken.json');
    writeFileSync(path, '{ not json');
    expect(() => loadRiskListConfig(path)).toThrow(/broken\.json is not valid JSON/);
  });

  it('reports a missing file', () => {
    expect(() => loadRiskListConfig(join(dir, 'missing.json'))).toThrow(
      /Cannot read config/
    );
  });
});
