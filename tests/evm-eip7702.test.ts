import { describe, it, expect } from 'vitest';
import { serializeTransaction, type Hex } from 'viem';
import { ZERO_ADDRESS } from '../src/evm/hex';
import {
  MAX_EIP7702_AUTHORIZATIONS,
  hasEip7702BroadDelegate,
  hasEip7702Delegation,
  parseEip7702,
} from '../src/evm/eip7702';

const DELEGATE = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const TO = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const R: Hex = `0x${'11'.repeat(32)}`;
const S: Hex = `0x${'22'.repeat(32)}`;

function auth(chainId: number, address: Hex, nonce = 0) {
  return {
    chainId,
    address,
    nonce,
    r: R,
    s: S,
    yParity: 1 as const,
  };
}

function type4Tx(authorizations: ReturnType<typeof auth>[], data: Hex = '0x'): Hex {
  return serializeTransaction({
    type: 'eip7702',
    chainId: 1,
    nonce: 7,
    maxPriorityFeePerGas: 1n,
    maxFeePerGas: 2n,
    gas: 50_000n,
    to: TO,
    value: 0n,
    data,
    authorizationList: authorizations,
  });
}

describe('parseEip7702', () => {
  it('returns null for non-type-4 payloads', () => {
    expect(parseEip7702('0x02abcd')).toBeNull();
    expect(parseEip7702('0x')).toBeNull();
    expect(parseEip7702('0x095ea7b3')).toBeNull();
  });

  it('throws on invalid hex', () => {
    expect(() => parseEip7702('0xzz')).toThrow(/Invalid hex data/);
  });

  it('decodes a signed type-4 tx and marks a chain-bound delegate', () => {
    const raw = type4Tx([auth(1, DELEGATE, 3)]);
    const decoded = parseEip7702(raw)!;
    expect(decoded.method).toBe('eip7702');
    expect(decoded.chainId).toBe(1n);
    expect(decoded.nonce).toBe(7n);
    expect(decoded.to).toBe(TO);
    expect(decoded.value).toBe(0n);
    expect(decoded.data).toBe('0x');
    expect(decoded.authorizations).toHaveLength(1);
    const item = decoded.authorizations[0]!;
    expect(item.address).toBe(DELEGATE);
    expect(item.chainId).toBe(1n);
    expect(item.nonce).toBe(3n);
    expect(item.isAnyChain).toBe(false);
    expect(item.isRevocation).toBe(false);
    expect(hasEip7702Delegation(decoded)).toBe(true);
    expect(hasEip7702BroadDelegate(decoded)).toBe(false);
  });

  it('flags chain_id 0 as a broad designation and zero address as a revoke', () => {
    const broad = parseEip7702(type4Tx([auth(0, DELEGATE)]))!;
    expect(broad.authorizations[0]?.isAnyChain).toBe(true);
    expect(hasEip7702BroadDelegate(broad)).toBe(true);

    const revoke = parseEip7702(type4Tx([auth(1, ZERO_ADDRESS as Hex)]))!;
    expect(revoke.authorizations[0]?.isRevocation).toBe(true);
    expect(hasEip7702Delegation(revoke)).toBe(false);
    expect(hasEip7702BroadDelegate(revoke)).toBe(false);
  });

  it('keeps inner calldata so later analysis can decode the destination call', () => {
    const data = `0x095ea7b3${'00'.repeat(32)}${'00'.repeat(32)}` as Hex;
    const decoded = parseEip7702(type4Tx([auth(1, DELEGATE)], data))!;
    expect(decoded.data).toBe(data);
  });

  it('rejects an empty list and one above the cap', () => {
    expect(() => parseEip7702(type4Tx([]))).toThrow(/empty/);
    const tooMany = Array.from(
      { length: MAX_EIP7702_AUTHORIZATIONS + 1 },
      () => auth(1, DELEGATE)
    );
    expect(() => parseEip7702(type4Tx(tooMany))).toThrow(/too large/);
  });

  it('throws when the type-4 prefix is present but the payload is truncated', () => {
    const full = type4Tx([auth(1, DELEGATE)]);
    expect(() => parseEip7702(full.slice(0, 8))).toThrow(/EIP-7702/);
  });
});
