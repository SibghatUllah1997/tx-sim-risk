import { readFileSync } from 'node:fs';
import { normalizeAddressKey } from './evm/phishing';

/**
 * User-supplied address lists that tune spender/operator risk rules.
 *
 * - `block`: addresses the user never wants to grant approvals to. A grant
 *   to one of them emits `blocklisted_spender`.
 * - `allow`: addresses the user trusts. A grant to one of them skips the
 *   `approval_to_eoa` heuristic only. It never hides a block-list or
 *   phishing-list hit, and never hides amount-based risks such as
 *   `unlimited_approval`.
 *
 * An address on both lists is treated as blocked.
 */
export type RiskListConfig = {
  /** Lowercase 0x-prefixed addresses. */
  allow: ReadonlySet<string>;
  /** Lowercase 0x-prefixed address → label (address itself when unlabeled). */
  block: ReadonlyMap<string, string>;
};

export const EMPTY_RISK_LISTS: RiskListConfig = Object.freeze({
  allow: new Set<string>(),
  block: new Map<string, string>(),
});

type RawBlockEntry = string | { address: string; label?: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function keyOrThrow(address: unknown, where: string): string {
  if (typeof address !== 'string') {
    throw new Error(`${where}: expected an address string`);
  }
  const key = normalizeAddressKey(address.trim());
  if (!key) throw new Error(`${where}: invalid address ${address}`);
  return key;
}

function listOrEmpty(value: unknown, field: string): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Error(`Config field "${field}" must be an array`);
  }
  return value;
}

/**
 * Validate a parsed JSON config object. Throws with the offending field
 * path on any bad entry, so a typo never silently disables a rule.
 *
 * Accepted shape:
 * ```json
 * {
 *   "allow": ["0x…"],
 *   "block": ["0x…", { "address": "0x…", "label": "my-label" }]
 * }
 * ```
 */
export function parseRiskListConfig(input: unknown): RiskListConfig {
  if (!isRecord(input)) {
    throw new Error('Config must be a JSON object with "allow" and/or "block"');
  }
  const unknownKeys = Object.keys(input).filter(
    (k) => k !== 'allow' && k !== 'block'
  );
  if (unknownKeys.length > 0) {
    throw new Error(`Unknown config field(s): ${unknownKeys.join(', ')}`);
  }

  const allow = new Set<string>();
  listOrEmpty(input.allow, 'allow').forEach((entry, i) => {
    allow.add(keyOrThrow(entry, `allow[${i}]`));
  });

  const block = new Map<string, string>();
  listOrEmpty(input.block, 'block').forEach((raw, i) => {
    const entry = raw as RawBlockEntry;
    if (typeof entry === 'string') {
      const key = keyOrThrow(entry, `block[${i}]`);
      block.set(key, key);
      return;
    }
    if (!isRecord(entry)) {
      throw new Error(`block[${i}]: expected an address string or object`);
    }
    const key = keyOrThrow(entry.address, `block[${i}].address`);
    if (entry.label !== undefined && typeof entry.label !== 'string') {
      throw new Error(`block[${i}].label: expected a string`);
    }
    block.set(key, entry.label?.trim() || key);
  });

  return { allow, block };
}

/** Read and validate a JSON risk-list config file. */
export function loadRiskListConfig(path: string): RiskListConfig {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Cannot read config ${path}: ${reason}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Config ${path} is not valid JSON: ${reason}`);
  }
  return parseRiskListConfig(parsed);
}

/** True when `address` is on the configured block list. */
export function isBlocklisted(
  address: string,
  lists: RiskListConfig = EMPTY_RISK_LISTS
): boolean {
  const key = normalizeAddressKey(address);
  return key !== null && lists.block.has(key);
}

/**
 * True when `address` is on the allow list and NOT on the block list
 * (block always wins).
 */
export function isAllowlisted(
  address: string,
  lists: RiskListConfig = EMPTY_RISK_LISTS
): boolean {
  const key = normalizeAddressKey(address);
  return key !== null && lists.allow.has(key) && !lists.block.has(key);
}

/** Risk id emitted when an approval grant targets a block-listed address. */
export const BLOCKLISTED_SPENDER_RISK = 'blocklisted_spender';

/** Risk ids for a grant to `address` under the configured block list. */
export function blocklistRisks(
  address: string,
  lists: RiskListConfig = EMPTY_RISK_LISTS
): string[] {
  return isBlocklisted(address, lists) ? [BLOCKLISTED_SPENDER_RISK] : [];
}
