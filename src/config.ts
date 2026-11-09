import { readFileSync } from 'node:fs';
import { normalizeAddressKey } from './evm/phishing';

/**
 * User-supplied address lists that tune spender/operator risk rules.
 *
 * - `block`: addresses the caller never wants to grant approvals to.
 *   A grant to one of them emits {@link BLOCKLISTED_SPENDER_RISK}.
 * - `allow`: addresses the caller trusts. A grant to one of them skips
 *   the `approval_to_eoa` heuristic only. It never hides a block-list
 *   or phishing-list hit, and never hides amount-based risks such as
 *   unlimited approval.
 *
 * An address present on both lists is treated as blocked.
 */
export type AddressLists = {
  /** Lowercase 0x-prefixed 20-byte addresses. */
  allow: ReadonlySet<string>;
  /** Lowercase 0x-prefixed address → label (the address itself when unlabeled). */
  block: ReadonlyMap<string, string>;
};

export const EMPTY_ADDRESS_LISTS: AddressLists = Object.freeze({
  allow: new Set<string>(),
  block: new Map<string, string>(),
});

const ALLOWED_ROOT_KEYS = new Set(['allow', 'block']);
const ALLOWED_BLOCK_OBJECT_KEYS = new Set(['address', 'label']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rejectUnknownKeys(
  record: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  where: string
): void {
  const extra = Object.keys(record).filter((key) => !allowed.has(key));
  if (extra.length > 0) {
    throw new Error(`${where}: unknown field(s): ${extra.join(', ')}`);
  }
}

function requireAddress(value: unknown, where: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${where}: expected an address string`);
  }
  const trimmed = value.trim();
  const key = normalizeAddressKey(trimmed);
  if (!key) {
    throw new Error(`${where}: invalid address ${value}`);
  }
  return key;
}

function asArray(value: unknown, field: string): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Error(`Config field "${field}" must be an array`);
  }
  return value;
}

function parseBlockEntry(raw: unknown, index: number): [string, string] {
  const where = `block[${index}]`;
  if (typeof raw === 'string') {
    const key = requireAddress(raw, where);
    return [key, key];
  }
  if (!isPlainObject(raw)) {
    throw new Error(`${where}: expected an address string or object`);
  }
  rejectUnknownKeys(raw, ALLOWED_BLOCK_OBJECT_KEYS, where);
  const key = requireAddress(raw.address, `${where}.address`);
  if (raw.label !== undefined && typeof raw.label !== 'string') {
    throw new Error(`${where}.label: expected a string`);
  }
  const label = raw.label?.trim();
  return [key, label ? label : key];
}

/**
 * Validate a parsed JSON config object. Throws with the offending field
 * path on any bad entry, so a typo never silently disables a rule.
 *
 * Accepted shape:
 * ```json
 * {
 *   "allow": ["0x…"],
 *   "block": ["0x…", { "address": "0x…", "label": "old-router" }]
 * }
 * ```
 *
 * Duplicate `allow` entries collapse. Duplicate `block` addresses keep
 * the last label. Missing `allow` / `block` fields are treated as empty.
 */
export function parseAddressLists(input: unknown): AddressLists {
  if (!isPlainObject(input)) {
    throw new Error('Config must be a JSON object with "allow" and/or "block"');
  }
  rejectUnknownKeys(input, ALLOWED_ROOT_KEYS, 'Config');

  const allow = new Set<string>();
  asArray(input.allow, 'allow').forEach((entry, i) => {
    allow.add(requireAddress(entry, `allow[${i}]`));
  });

  const block = new Map<string, string>();
  asArray(input.block, 'block').forEach((entry, i) => {
    const [key, label] = parseBlockEntry(entry, i);
    block.set(key, label);
  });

  return { allow, block };
}

/** Read and validate a JSON address-list config file. */
export function loadAddressLists(path: string): AddressLists {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Cannot read config ${path}: ${reason}`);
  }
  // Strip a UTF-8 BOM so editors that insert one still parse.
  text = text.replace(/^\uFEFF/, '');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Config ${path} is not valid JSON: ${reason}`);
  }
  return parseAddressLists(parsed);
}

/**
 * Combine two configs. `extra` allow entries are unioned onto `base`;
 * `extra` block entries overwrite the same address on `base`. Matching
 * still treats block as higher priority than allow.
 */
export function mergeAddressLists(
  base: AddressLists,
  extra: AddressLists
): AddressLists {
  const allow = new Set(base.allow);
  for (const address of extra.allow) allow.add(address);
  const block = new Map(base.block);
  for (const [address, label] of extra.block) block.set(address, label);
  return { allow, block };
}

/** True when `address` is on the configured block list. */
export function isBlocklisted(
  address: string,
  lists: AddressLists = EMPTY_ADDRESS_LISTS
): boolean {
  const key = normalizeAddressKey(address);
  return key !== null && lists.block.has(key);
}

/**
 * True when `address` is on the allow list and not on the block list
 * (block always wins).
 */
export function isAllowlisted(
  address: string,
  lists: AddressLists = EMPTY_ADDRESS_LISTS
): boolean {
  const key = normalizeAddressKey(address);
  return key !== null && lists.allow.has(key) && !lists.block.has(key);
}

/** Label for a block-listed address, or undefined when it is not blocked. */
export function lookupBlockLabel(
  address: string,
  lists: AddressLists = EMPTY_ADDRESS_LISTS
): string | undefined {
  const key = normalizeAddressKey(address);
  if (!key) return undefined;
  return lists.block.get(key);
}

/** Risk id emitted when an approval grant targets a block-listed address. */
export const BLOCKLISTED_SPENDER_RISK = 'blocklisted_spender';

/** Risk ids for a grant to `address` under the configured block list. */
export function blocklistedSpenderRisks(
  address: string,
  lists: AddressLists = EMPTY_ADDRESS_LISTS
): string[] {
  return isBlocklisted(address, lists) ? [BLOCKLISTED_SPENDER_RISK] : [];
}
