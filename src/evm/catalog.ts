import { normalizeAddressKey } from './phishing';

/** Kind of a well-known on-chain address shown in reports. */
export type CatalogKind = 'router' | 'bridge' | 'token' | 'permit';

export type CatalogEntry = {
  /** Lowercase 0x-prefixed 20-byte address. */
  address: string;
  /** Human-readable name, e.g. "Uniswap V2 Router". */
  name: string;
  kind: CatalogKind;
};

/** Name and kind to attach to a spender, recipient, or operator. */
export type AddressLabel = {
  name: string;
  kind: CatalogKind;
};

/**
 * Built-in seed of widely used Ethereum mainnet routers, bridges, tokens,
 * and the Permit2 contract. Offline labels only: unknown addresses stay
 * unlabelled. Callers can merge extra entries via {@link mergeCatalogEntries}.
 */
const SEED_ENTRIES: readonly CatalogEntry[] = [
  {
    address: '0x7a250d5630b4cf539739df2c5dacb4c659f2488d',
    name: 'Uniswap V2 Router',
    kind: 'router',
  },
  {
    address: '0xe592427a0aece92de3edee1f18e0157c05861564',
    name: 'Uniswap V3 SwapRouter',
    kind: 'router',
  },
  {
    address: '0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad',
    name: 'Uniswap Universal Router',
    kind: 'router',
  },
  {
    address: '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45',
    name: 'Uniswap SwapRouter02',
    kind: 'router',
  },
  {
    address: '0xd9e1ce17f2641f24ae83637ab66a2cca9c378b9f',
    name: 'SushiSwap Router',
    kind: 'router',
  },
  {
    address: '0x1111111254eeb25477b68fb85ed929f73a960582',
    name: '1inch v5 Aggregation Router',
    kind: 'router',
  },
  {
    address: '0x111111125421ca6dc452d289314280a0f8842a65',
    name: '1inch v6 Aggregation Router',
    kind: 'router',
  },
  {
    address: '0xdef1c0ded9bec7f1a1670819833240f027b25eff',
    name: '0x Exchange Proxy',
    kind: 'router',
  },
  {
    address: '0x9008d19f58aabd9ed0d60971565aa8510560ab41',
    name: 'Cow Protocol GPv2Settlement',
    kind: 'router',
  },
  {
    address: '0x4dbd4fc535ac27206064b68ffcf827b0a60bab3f',
    name: 'Arbitrum Delayed Inbox',
    kind: 'bridge',
  },
  {
    address: '0x99c9fc46f92e8a1c0dec1b1747d010903e884be1',
    name: 'Optimism L1StandardBridge',
    kind: 'bridge',
  },
  {
    address: '0xa0c68c638235ee32657e8f720a23cec1bfc77c77',
    name: 'Polygon PoS Bridge',
    kind: 'bridge',
  },
  {
    address: '0x5c7bcd6e7de5423a257d81b442095a1a6ced35c5',
    name: 'Across SpokePool',
    kind: 'bridge',
  },
  {
    address: '0x3ee18b2214aff97000d974cf647e7c347e8fa585',
    name: 'Wormhole Token Bridge',
    kind: 'bridge',
  },
  {
    address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
    name: 'Wrapped Ether',
    kind: 'token',
  },
  {
    address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    name: 'USD Coin',
    kind: 'token',
  },
  {
    address: '0xdac17f958d2ee523a2206206994597c13d831ec7',
    name: 'Tether USD',
    kind: 'token',
  },
  {
    address: '0x6b175474e89094c44da98b954eedeac495271d0f',
    name: 'Dai Stablecoin',
    kind: 'token',
  },
  {
    address: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599',
    name: 'Wrapped BTC',
    kind: 'token',
  },
  {
    address: '0x000000000022d473030f116ddee9f6b43ac78ba3',
    name: 'Permit2',
    kind: 'permit',
  },
];

function freezeEntry(entry: CatalogEntry): CatalogEntry {
  const key = normalizeAddressKey(entry.address);
  if (!key) {
    throw new Error(`Invalid catalog address: ${entry.address}`);
  }
  if (!entry.name.trim()) {
    throw new Error(`Catalog entry ${key} is missing a name`);
  }
  return Object.freeze({
    address: key,
    name: entry.name.trim(),
    kind: entry.kind,
  });
}

export const DEFAULT_ADDRESS_CATALOG: readonly CatalogEntry[] = Object.freeze(
  SEED_ENTRIES.map(freezeEntry)
);

/**
 * Addresses in the catalog, used as the default known-contract set.
 * Every labelled entry is a contract on Ethereum mainnet.
 */
export const CATALOG_CONTRACT_ADDRESSES: readonly string[] = Object.freeze(
  DEFAULT_ADDRESS_CATALOG.map((entry) => entry.address)
);

/**
 * Build an address → entry index. Duplicate addresses keep the last entry.
 * Throws if any address is not 20-byte hex or a name is empty.
 */
export function createCatalogIndex(
  entries: readonly CatalogEntry[] = DEFAULT_ADDRESS_CATALOG
): ReadonlyMap<string, CatalogEntry> {
  const map = new Map<string, CatalogEntry>();
  for (const entry of entries) {
    const frozen = freezeEntry(entry);
    map.set(frozen.address, frozen);
  }
  return map;
}

const DEFAULT_INDEX = createCatalogIndex();

/**
 * Look up a catalog entry by address. Matching is case-insensitive and
 * accepts a missing `0x` prefix. Returns undefined for unknown or invalid
 * input (does not throw).
 */
export function lookupCatalogEntry(
  address: string,
  index: ReadonlyMap<string, CatalogEntry> = DEFAULT_INDEX
): CatalogEntry | undefined {
  const key = normalizeAddressKey(address);
  if (!key) return undefined;
  return index.get(key);
}

/**
 * Name and kind for `address`, or null when it is not in the catalog.
 * Invalid addresses return null rather than throwing so reports can label
 * whatever they already decoded.
 */
export function lookupAddressLabel(
  address: string | null | undefined,
  index: ReadonlyMap<string, CatalogEntry> = DEFAULT_INDEX
): AddressLabel | null {
  if (!address) return null;
  const entry = lookupCatalogEntry(address, index);
  return entry ? { name: entry.name, kind: entry.kind } : null;
}

/** Plain-text "Name (kind)" line, or null when there is no label. */
export function formatAddressLabel(label: AddressLabel | null): string | null {
  if (!label) return null;
  return `${label.name} (${label.kind})`;
}

/**
 * Return a new list with `extra` merged onto `base`. Extra entries with the
 * same address replace the base entry.
 */
export function mergeCatalogEntries(
  extra: readonly CatalogEntry[],
  base: readonly CatalogEntry[] = DEFAULT_ADDRESS_CATALOG
): readonly CatalogEntry[] {
  return Object.freeze([...createCatalogIndex([...base, ...extra]).values()]);
}
