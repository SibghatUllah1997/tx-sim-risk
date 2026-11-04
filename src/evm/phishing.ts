import { isAddressHexLike } from './address';
import { stripHexPrefix } from './hex';

export type PhishingCategory =
  | 'drainer'
  | 'fake_support'
  | 'token_approval_scam';

export type PhishingEntry = {
  /** Lowercase 0x-prefixed 20-byte address. */
  address: string;
  /** Short stable id for logs and tests. */
  label: string;
  category: PhishingCategory;
};

/**
 * Normalize a 20-byte address to lowercase `0x…`. Returns null when the
 * string is not a 40-hex-character address (checksum is not required).
 */
export function normalizeAddressKey(address: string): string | null {
  if (!isAddressHexLike(address)) return null;
  return `0x${stripHexPrefix(address).toLowerCase()}`;
}

/**
 * Built-in seed of known-bad approval spenders for offline matching.
 *
 * These addresses are the canonical fixtures this tool ships with so
 * matching can be tested without a network. Callers should merge current
 * threat-intel on top via {@link mergePhishingEntries}.
 */
const SEED_ENTRIES: readonly PhishingEntry[] = [
  {
    address: '0xbad0000000000000000000000000000000000001',
    label: 'seed_drainer_primary',
    category: 'drainer',
  },
  {
    address: '0xbad0000000000000000000000000000000000002',
    label: 'seed_fake_support',
    category: 'fake_support',
  },
  {
    address: '0xbad0000000000000000000000000000000000003',
    label: 'seed_approval_scam',
    category: 'token_approval_scam',
  },
];

function freezeEntry(entry: PhishingEntry): PhishingEntry {
  const key = normalizeAddressKey(entry.address);
  if (!key) {
    throw new Error(`Invalid phishing list address: ${entry.address}`);
  }
  return Object.freeze({
    address: key,
    label: entry.label,
    category: entry.category,
  });
}

export const DEFAULT_PHISHING_LIST: readonly PhishingEntry[] = Object.freeze(
  SEED_ENTRIES.map(freezeEntry)
);

/**
 * Build an address → entry index. Duplicate addresses keep the last entry.
 * Throws if any address is not 20-byte hex.
 */
export function createPhishingIndex(
  entries: readonly PhishingEntry[] = DEFAULT_PHISHING_LIST
): ReadonlyMap<string, PhishingEntry> {
  const map = new Map<string, PhishingEntry>();
  for (const entry of entries) {
    const frozen = freezeEntry(entry);
    map.set(frozen.address, frozen);
  }
  return map;
}

const DEFAULT_INDEX = createPhishingIndex();

/**
 * Look up a phishing entry by address. Matching is case-insensitive and
 * accepts a missing `0x` prefix. Returns undefined for unknown or invalid
 * input (does not throw).
 */
export function lookupPhishingEntry(
  address: string,
  index: ReadonlyMap<string, PhishingEntry> = DEFAULT_INDEX
): PhishingEntry | undefined {
  const key = normalizeAddressKey(address);
  if (!key) return undefined;
  return index.get(key);
}

/**
 * True when `address` is on the given phishing index (default: built-in seed).
 */
export function isKnownPhishingAddress(
  address: string,
  index: ReadonlyMap<string, PhishingEntry> = DEFAULT_INDEX
): boolean {
  return lookupPhishingEntry(address, index) !== undefined;
}

/** Risk id emitted when an approval grant targets a known phishing address. */
export const PHISHING_SPENDER_RISK = 'phishing_spender';

/**
 * Risk ids for an approval-style grant to `address`. Empty when the address
 * is not on the phishing index (or is not a valid address).
 */
export function phishingSpenderRisks(
  address: string,
  index: ReadonlyMap<string, PhishingEntry> = DEFAULT_INDEX
): string[] {
  return isKnownPhishingAddress(address, index) ? [PHISHING_SPENDER_RISK] : [];
}

/**
 * Return a new list with `extra` merged onto `base`. Extra entries with the
 * same address replace the base entry.
 */
export function mergePhishingEntries(
  extra: readonly PhishingEntry[],
  base: readonly PhishingEntry[] = DEFAULT_PHISHING_LIST
): readonly PhishingEntry[] {
  return Object.freeze([...createPhishingIndex([...base, ...extra]).values()]);
}
