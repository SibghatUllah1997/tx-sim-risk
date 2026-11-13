import { describe, expect, it } from 'vitest';
import { encodeFunctionData, parseAbi } from 'viem';
import {
  MAX_UINT256,
  UNLIMITED_PERMIT_RISK,
  decodeDaiPermit,
  decodeEip2612Permit,
  decodeErc20Permit,
  unlimitedPermitRisks,
} from '../src';

const OWNER = '0x1111111111111111111111111111111111111111';
const SPENDER = '0x7a250d5630b4cf539739df2c5dacb4c659f2488d';
const R = `0x${'ab'.repeat(32)}` as const;
const S = `0x${'cd'.repeat(32)}` as const;

const ABI = parseAbi([
  'function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)',
  'function permit(address holder, address spender, uint256 nonce, uint256 expiry, bool allowed, uint8 v, bytes32 r, bytes32 s)',
]);

function eip2612(value: bigint, deadline: bigint): `0x${string}` {
  return encodeFunctionData({
    abi: [ABI[0]],
    functionName: 'permit',
    args: [OWNER, SPENDER, value, deadline, 27, R, S],
  });
}

function dai(allowed: boolean, expiry: bigint, nonce = 3n): `0x${string}` {
  return encodeFunctionData({
    abi: [ABI[1]],
    functionName: 'permit',
    args: [OWNER, SPENDER, nonce, expiry, allowed, 28, R, S],
  });
}

describe('EIP-2612 permit', () => {
  it('decodes owner, spender, value and deadline', () => {
    const decoded = decodeEip2612Permit(eip2612(500n, 1_900_000_000n));
    expect(decoded).toEqual({
      method: 'erc20_permit',
      variant: 'eip2612',
      owner: OWNER,
      spender: SPENDER,
      value: 500n,
      deadline: 1_900_000_000n,
      nonce: null,
      allowed: null,
      isUnlimitedPermit: false,
      hasNoExpiry: false,
    });
  });

  it('flags a max-uint256 value and a never-reached deadline', () => {
    const decoded = decodeEip2612Permit(eip2612(MAX_UINT256, MAX_UINT256))!;
    expect(decoded.isUnlimitedPermit).toBe(true);
    expect(decoded.hasNoExpiry).toBe(true);
    expect(unlimitedPermitRisks(decoded)).toEqual([UNLIMITED_PERMIT_RISK]);
  });

  it('ignores the DAI selector and other calls', () => {
    expect(decodeEip2612Permit(dai(true, 0n))).toBeNull();
    expect(decodeEip2612Permit('0x095ea7b3')).toBeNull();
  });

  it('throws on truncated calldata', () => {
    expect(() =>
      decodeEip2612Permit(eip2612(1n, 1n).slice(0, 10 + 64 * 6))
    ).toThrow(/too short/);
  });

  it('rejects a v word that is not a uint8', () => {
    const data = eip2612(1n, 1n);
    const vStart = 10 + 64 * 4;
    const bad = `${data.slice(0, vStart)}${'0'.repeat(60)}0100${data.slice(vStart + 64)}`;
    expect(() => decodeEip2612Permit(bad)).toThrow(/uint8/);
  });
});

describe('DAI-style permit', () => {
  it('maps allowed=true to an unlimited allowance', () => {
    const decoded = decodeDaiPermit(dai(true, 1_900_000_000n, 9n))!;
    expect(decoded.variant).toBe('dai');
    expect(decoded.owner).toBe(OWNER);
    expect(decoded.spender).toBe(SPENDER);
    expect(decoded.nonce).toBe(9n);
    expect(decoded.allowed).toBe(true);
    expect(decoded.value).toBe(MAX_UINT256);
    expect(decoded.isUnlimitedPermit).toBe(true);
    expect(decoded.hasNoExpiry).toBe(false);
  });

  it('maps allowed=false to a zero allowance (a revoke)', () => {
    const decoded = decodeDaiPermit(dai(false, 1n))!;
    expect(decoded.value).toBe(0n);
    expect(decoded.isUnlimitedPermit).toBe(false);
    expect(unlimitedPermitRisks(decoded)).toEqual([]);
  });

  it('treats expiry 0 as no expiry', () => {
    expect(decodeDaiPermit(dai(true, 0n))!.hasNoExpiry).toBe(true);
  });

  it('rejects a non-boolean allowed word', () => {
    const data = dai(true, 1n);
    const start = 10 + 64 * 4;
    const bad = `${data.slice(0, start)}${'0'.repeat(63)}2${data.slice(start + 64)}`;
    expect(() => decodeDaiPermit(bad)).toThrow(/bool/);
  });
});

describe('decodeErc20Permit', () => {
  it('accepts either ABI and returns null otherwise', () => {
    expect(decodeErc20Permit(eip2612(1n, 1n))?.variant).toBe('eip2612');
    expect(decodeErc20Permit(dai(true, 1n))?.variant).toBe('dai');
    expect(decodeErc20Permit(`0x${'00'.repeat(4)}`)).toBeNull();
  });
});
