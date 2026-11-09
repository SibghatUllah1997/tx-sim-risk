import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BLOCKLISTED_SPENDER_RISK,
  blocklistedSpenderRisks,
  isAllowlisted,
  isBlocklisted,
  loadAddressLists,
  lookupBlockLabel,
  mergeAddressLists,
  parseAddressLists,
} from '../src';

const A = '0xAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAa';
const B = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const C = '0xcccccccccccccccccccccccccccccccccccccccc';

describe('parseAddressLists', () => {
  it('normalizes addresses to lowercase 0x keys', () => {
    const lists = parseAddressLists({ allow: [A], block: [B] });
    expect([...lists.allow]).toEqual([A.toLowerCase()]);
    expect(lists.block.get(B)).toBe(B);
  });

  it('accepts labeled block entries and omitted fields', () => {
    const lists = parseAddressLists({
      block: [{ address: B, label: 'old-router' }],
    });
    expect(lists.allow.size).toBe(0);
    expect(lists.block.get(B)).toBe('old-router');
    expect(lookupBlockLabel(B, lists)).toBe('old-router');
  });

  it('falls back to the address when a block label is blank', () => {
    const lists = parseAddressLists({
      block: [{ address: B, label: '   ' }],
    });
    expect(lists.block.get(B)).toBe(B);
  });

  it('accepts an address without the 0x prefix and trims whitespace', () => {
    const lists = parseAddressLists({
      allow: [`  ${A}  `],
      block: [`  ${B.slice(2)}  `],
    });
    expect(isAllowlisted(A, lists)).toBe(true);
    expect(isBlocklisted(B, lists)).toBe(true);
  });

  it('collapses duplicate allow entries and keeps the last block label', () => {
    const lists = parseAddressLists({
      allow: [A, A.toLowerCase()],
      block: [B, { address: B, label: 'final' }],
    });
    expect(lists.allow.size).toBe(1);
    expect(lists.block.get(B)).toBe('final');
  });

  it('treats an empty object as empty lists', () => {
    const lists = parseAddressLists({});
    expect(lists.allow.size).toBe(0);
    expect(lists.block.size).toBe(0);
  });

  it.each([
    [null, /JSON object/],
    [[], /JSON object/],
    [{ allow: 'x' }, /"allow" must be an array/],
    [{ allow: ['0x123'] }, /allow\[0\]: invalid address/],
    [{ allow: [{ address: A }] }, /allow\[0\]: expected an address string/],
    [{ block: [{ label: 'no address' }] }, /block\[0\]\.address/],
    [{ block: [{ address: B, label: 7 }] }, /block\[0\]\.label/],
    [{ block: [{ address: B, note: 'x' }] }, /block\[0\]: unknown field/],
    [{ allowlist: [A] }, /unknown field\(s\): allowlist/i],
    [{ block: [null] }, /block\[0\]: expected an address string or object/],
  ])('rejects bad config %j', (input, message) => {
    expect(() => parseAddressLists(input)).toThrow(message);
  });
});

describe('allow/block matching', () => {
  const lists = parseAddressLists({ allow: [A, B], block: [B] });

  it('treats an address on both lists as blocked, not allowed', () => {
    expect(isBlocklisted(B, lists)).toBe(true);
    expect(isAllowlisted(B, lists)).toBe(false);
  });

  it('matches allow-listed addresses case-insensitively', () => {
    expect(isAllowlisted(A.toLowerCase(), lists)).toBe(true);
    expect(isAllowlisted(A.toUpperCase(), lists)).toBe(true);
  });

  it('emits blocklisted_spender only for block-listed addresses', () => {
    expect(blocklistedSpenderRisks(B, lists)).toEqual([BLOCKLISTED_SPENDER_RISK]);
    expect(blocklistedSpenderRisks(A, lists)).toEqual([]);
    expect(blocklistedSpenderRisks('not-an-address', lists)).toEqual([]);
  });

  it('matches nothing without a config', () => {
    expect(isBlocklisted(B)).toBe(false);
    expect(isAllowlisted(A)).toBe(false);
    expect(lookupBlockLabel(B)).toBeUndefined();
  });
});

describe('mergeAddressLists', () => {
  it('unions allow entries and lets extra block labels overwrite', () => {
    const base = parseAddressLists({
      allow: [A],
      block: [{ address: B, label: 'old' }],
    });
    const extra = parseAddressLists({
      allow: [C],
      block: [{ address: B, label: 'new' }],
    });
    const merged = mergeAddressLists(base, extra);
    expect(isAllowlisted(A, merged)).toBe(true);
    expect(isAllowlisted(C, merged)).toBe(true);
    expect(lookupBlockLabel(B, merged)).toBe('new');
  });
});

describe('loadAddressLists', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tx-sim-risk-'));

  it('loads a JSON file from disk, including a leading UTF-8 BOM', () => {
    const path = join(dir, 'lists.json');
    writeFileSync(path, `\uFEFF${JSON.stringify({ block: [B] })}`);
    expect(isBlocklisted(B, loadAddressLists(path))).toBe(true);
  });

  it('reports invalid JSON with the file path', () => {
    const path = join(dir, 'broken.json');
    writeFileSync(path, '{ not json');
    expect(() => loadAddressLists(path)).toThrow(/broken\.json is not valid JSON/);
  });

  it('reports a missing file', () => {
    expect(() => loadAddressLists(join(dir, 'missing.json'))).toThrow(
      /Cannot read config/
    );
  });
});
