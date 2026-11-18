import { describe, it, expect } from 'vitest';
import {
  CATALOG_CONTRACT_ADDRESSES,
  DEFAULT_ADDRESS_CATALOG,
  DEFAULT_KNOWN_CONTRACTS,
  createCatalogIndex,
  formatAddressLabel,
  lookupAddressLabel,
  lookupCatalogEntry,
  mergeCatalogEntries,
} from '../src';

const UNISWAP_V2 = '0x7a250d5630b4cf539739df2c5dacb4c659f2488d';
const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
const ARBITRUM_INBOX = '0x4dbd4fc535ac27206064b68ffcf827b0a60bab3f';
const PERMIT2 = '0x000000000022d473030f116ddee9f6b43ac78ba3';
const UNKNOWN = '0x1111111111111111111111111111111111111111';

describe('address catalog', () => {
  it('labels routers, bridges, tokens, and Permit2 from the seed list', () => {
    expect(lookupAddressLabel(UNISWAP_V2)).toEqual({
      name: 'Uniswap V2 Router',
      kind: 'router',
    });
    expect(lookupAddressLabel(ARBITRUM_INBOX.toUpperCase())).toEqual({
      name: 'Arbitrum Delayed Inbox',
      kind: 'bridge',
    });
    expect(lookupAddressLabel(WETH.slice(2))).toEqual({
      name: 'Wrapped Ether',
      kind: 'token',
    });
    expect(lookupCatalogEntry(PERMIT2)?.kind).toBe('permit');
    expect(lookupAddressLabel(UNKNOWN)).toBeNull();
    expect(lookupAddressLabel(null)).toBeNull();
    expect(lookupAddressLabel('not-an-address')).toBeNull();
  });

  it('has unique lowercase addresses and a name for every seed entry', () => {
    const addresses = DEFAULT_ADDRESS_CATALOG.map((entry) => entry.address);
    expect(new Set(addresses).size).toBe(addresses.length);
    expect(addresses).toEqual(CATALOG_CONTRACT_ADDRESSES);
    expect(DEFAULT_KNOWN_CONTRACTS).toEqual(CATALOG_CONTRACT_ADDRESSES);
    for (const entry of DEFAULT_ADDRESS_CATALOG) {
      expect(entry.address).toMatch(/^0x[0-9a-f]{40}$/);
      expect(entry.name.length).toBeGreaterThan(2);
      expect(['router', 'bridge', 'token', 'permit']).toContain(entry.kind);
    }
    expect(DEFAULT_ADDRESS_CATALOG.some((e) => e.kind === 'router')).toBe(true);
    expect(DEFAULT_ADDRESS_CATALOG.some((e) => e.kind === 'bridge')).toBe(true);
    expect(DEFAULT_ADDRESS_CATALOG.some((e) => e.kind === 'token')).toBe(true);
    expect(DEFAULT_ADDRESS_CATALOG.some((e) => e.kind === 'permit')).toBe(true);
  });

  it('formats labels and merges extra entries over the seed', () => {
    expect(formatAddressLabel(lookupAddressLabel(UNISWAP_V2))).toBe(
      'Uniswap V2 Router (router)'
    );
    expect(formatAddressLabel(null)).toBeNull();

    const merged = mergeCatalogEntries([
      {
        address: UNISWAP_V2,
        name: 'Custom Router',
        kind: 'router',
      },
      {
        address: UNKNOWN,
        name: 'Test Token',
        kind: 'token',
      },
    ]);
    const index = createCatalogIndex(merged);
    expect(lookupAddressLabel(UNISWAP_V2, index)).toEqual({
      name: 'Custom Router',
      kind: 'router',
    });
    expect(lookupAddressLabel(UNKNOWN, index)?.name).toBe('Test Token');
    expect(lookupAddressLabel(WETH, index)?.kind).toBe('token');
  });

  it('throws on malformed addresses or empty names', () => {
    expect(() =>
      createCatalogIndex([{ address: '0xnope', name: 'X', kind: 'token' }])
    ).toThrow(/Invalid catalog address/);
    expect(() =>
      createCatalogIndex([{ address: UNKNOWN, name: '   ', kind: 'token' }])
    ).toThrow(/missing a name/);
  });
});
