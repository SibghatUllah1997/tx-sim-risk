import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PHISHING_LIST,
  PHISHING_SPENDER_RISK,
  createPhishingIndex,
  isKnownPhishingAddress,
  lookupPhishingEntry,
  mergePhishingEntries,
  normalizeAddressKey,
  phishingSpenderRisks,
} from '../src';

const SEED_DRAINER = '0xbad0000000000000000000000000000000000001';
const SEED_SUPPORT = '0xbad0000000000000000000000000000000000002';
const SEED_SCAM = '0xbad0000000000000000000000000000000000003';
const CLEAN = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

describe('phishing address list', () => {
  it('normalizes mixed-case and optional 0x to a lowercase key', () => {
    expect(normalizeAddressKey(SEED_DRAINER.toUpperCase())).toBe(SEED_DRAINER);
    expect(
      normalizeAddressKey('BAD0000000000000000000000000000000000001')
    ).toBe(SEED_DRAINER);
    expect(normalizeAddressKey('0xzz')).toBeNull();
    expect(normalizeAddressKey('0x' + 'ab'.repeat(19))).toBeNull();
  });

  it('ships an immutable seed of three known-bad spenders', () => {
    expect(DEFAULT_PHISHING_LIST).toHaveLength(3);
    expect(DEFAULT_PHISHING_LIST.map((e) => e.address).sort()).toEqual(
      [SEED_DRAINER, SEED_SUPPORT, SEED_SCAM].sort()
    );
    expect(() => {
      (DEFAULT_PHISHING_LIST as { address: string }[]).push({
        address: CLEAN,
      });
    }).toThrow();
  });

  it('matches seed addresses regardless of checksum casing', () => {
    expect(isKnownPhishingAddress(SEED_DRAINER)).toBe(true);
    expect(isKnownPhishingAddress(SEED_DRAINER.toUpperCase())).toBe(true);
    expect(
      isKnownPhishingAddress('BAD0000000000000000000000000000000000002')
    ).toBe(true);
    expect(isKnownPhishingAddress(CLEAN)).toBe(false);
    expect(isKnownPhishingAddress('not-an-address')).toBe(false);
  });

  it('returns the seed entry on lookup and undefined for unknown input', () => {
    const entry = lookupPhishingEntry(SEED_SCAM)!;
    expect(entry.label).toBe('seed_approval_scam');
    expect(entry.category).toBe('token_approval_scam');
    expect(lookupPhishingEntry(CLEAN)).toBeUndefined();
    expect(lookupPhishingEntry('0xgg')).toBeUndefined();
  });

  it('throws when building an index that contains a malformed address', () => {
    expect(() =>
      createPhishingIndex([
        {
          address: '0xshort',
          label: 'bad',
          category: 'drainer',
        },
      ])
    ).toThrowError(/invalid phishing list address/i);
  });

  it('merges extra entries and lets extras replace a seed address', () => {
    const extra = [
      {
        address: '0xcccccccccccccccccccccccccccccccccccccccc',
        label: 'extra_drainer',
        category: 'drainer' as const,
      },
      {
        address: SEED_DRAINER.toUpperCase(),
        label: 'replaced_primary',
        category: 'drainer' as const,
      },
    ];
    const merged = mergePhishingEntries(extra);
    const index = createPhishingIndex(merged);

    expect(isKnownPhishingAddress(extra[0]!.address, index)).toBe(true);
    expect(lookupPhishingEntry(SEED_DRAINER, index)?.label).toBe(
      'replaced_primary'
    );
    expect(isKnownPhishingAddress(SEED_SUPPORT, index)).toBe(true);
    expect(DEFAULT_PHISHING_LIST.find((e) => e.address === SEED_DRAINER)?.label)
      .toBe('seed_drainer_primary');
  });

  it('returns the phishing_spender risk id only for listed addresses', () => {
    expect(phishingSpenderRisks(SEED_DRAINER)).toEqual([PHISHING_SPENDER_RISK]);
    expect(phishingSpenderRisks(CLEAN)).toEqual([]);
    expect(phishingSpenderRisks('nope')).toEqual([]);
  });
});
