import { isAddressHexLike } from './address';
import { isHexString, stripHexPrefix } from './hex';

export type AddressKind = 'eoa' | 'contract' | 'unknown';

export type AddressKindHints = {
  /**
   * Bytecode from `eth_getCode`. Empty / `0x` means the account has no code
   * (EOA). Non-empty hex means a contract. Omit to fall through to `known`.
   */
  bytecode?: string | null;
  /** Explicit address → kind map. Keys should be lowercase `0x` addresses. */
  known?: ReadonlyMap<string, AddressKind>;
};

const ZERO_ADDRESS = `0x${'0'.repeat(40)}`;

function toAddressKey(address: string): string | null {
  if (!isAddressHexLike(address)) return null;
  return `0x${stripHexPrefix(address).toLowerCase()}`;
}

/**
 * Widely used Ethereum mainnet contracts that commonly appear as ERC-20
 * spenders (routers, permit vaults, wrapped native). Offline hint only:
 * anything not listed stays `unknown` unless bytecode is supplied.
 */
export const DEFAULT_KNOWN_CONTRACTS: readonly string[] = Object.freeze([
  '0x7a250d5630b4cf539739df2c5dacb4c659f2488d',
  '0xe592427a0aece92de3edee1f18e0157c05861564',
  '0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad',
  '0x000000000022d473030f116ddee9f6b43ac78ba3',
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
]);

/**
 * Build an address-kind map. `eoas` overwrite `contracts` on collision.
 * Throws if any address is not 20-byte hex.
 */
export function createAddressKindMap(
  contracts: readonly string[] = DEFAULT_KNOWN_CONTRACTS,
  eoas: readonly string[] = []
): ReadonlyMap<string, AddressKind> {
  const map = new Map<string, AddressKind>();
  for (const addr of contracts) {
    const key = toAddressKey(addr);
    if (!key) throw new Error(`Invalid contract address: ${addr}`);
    map.set(key, 'contract');
  }
  for (const addr of eoas) {
    const key = toAddressKey(addr);
    if (!key) throw new Error(`Invalid EOA address: ${addr}`);
    map.set(key, 'eoa');
  }
  return map;
}

const DEFAULT_KIND_MAP = createAddressKindMap();

/**
 * Classify bytecode from `eth_getCode`. Returns null when bytecode is absent
 * so callers can fall through to a known-address map.
 */
export function kindFromBytecode(
  bytecode: string | null | undefined
): AddressKind | null {
  if (bytecode == null) return null;
  if (!isHexString(bytecode)) {
    throw new Error('Invalid bytecode hex');
  }
  return stripHexPrefix(bytecode).length === 0 ? 'eoa' : 'contract';
}

/**
 * Classify an address as EOA, contract, or unknown.
 *
 * Priority:
 * 1. Invalid address → throws
 * 2. Zero address → `unknown` (not a usable spender kind)
 * 3. `hints.bytecode` when provided
 * 4. `hints.known` (default: {@link DEFAULT_KNOWN_CONTRACTS} as contracts)
 * 5. `unknown`
 */
export function classifyAddressKind(
  address: string,
  hints?: AddressKindHints
): AddressKind {
  const key = toAddressKey(address);
  if (!key) throw new Error('Invalid address format');
  if (key === ZERO_ADDRESS) return 'unknown';

  const fromCode = kindFromBytecode(hints?.bytecode);
  if (fromCode !== null) return fromCode;

  const known = hints?.known ?? DEFAULT_KIND_MAP;
  return known.get(key) ?? 'unknown';
}
