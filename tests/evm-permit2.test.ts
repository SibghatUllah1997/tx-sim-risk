import { describe, it, expect } from 'vitest';
import { encodeFunctionData, parseAbi, type Hex } from 'viem';
import {
  MAX_UINT256,
} from '../src/evm/hex';
import {
  MAX_UINT160,
  MAX_UINT48,
  decodePermit2,
  decodePermit2Approve,
  decodePermit2Permit,
  decodePermit2PermitBatch,
  decodePermit2PermitTransferFrom,
  PERMIT2_SIGNATURES,
} from '../src/evm/permit2';

const TOKEN = '0xcccccccccccccccccccccccccccccccccccccccc';
const SPENDER = '0x7a250d5630b4cf539739df2c5dacb4c659f2488d';
const OWNER = '0x1111111111111111111111111111111111111111';
const RECIPIENT = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const SIGNATURE: Hex = `0x${'ab'.repeat(65)}`;
const DEADLINE = 1_900_000_000n;
const EXPIRATION = 1_900_000_000n;

const APPROVE_ABI = parseAbi([
  'function approve(address token, address spender, uint160 amount, uint48 expiration)',
]);
const PERMIT_ABI = parseAbi([
  'function permit(address owner, ((address token, uint160 amount, uint48 expiration, uint48 nonce) details, address spender, uint256 sigDeadline) permitSingle, bytes signature)',
]);
const PERMIT_BATCH_ABI = parseAbi([
  'function permit(address owner, ((address token, uint160 amount, uint48 expiration, uint48 nonce)[] details, address spender, uint256 sigDeadline) permitBatch, bytes signature)',
]);
const TRANSFER_ABI = parseAbi([
  'function permitTransferFrom(((address token, uint256 amount) permitted, uint256 nonce, uint256 deadline) permit, (address to, uint256 requestedAmount) transferDetails, address owner, bytes signature)',
]);

function approveCall(amount: bigint, expiration: bigint): Hex {
  return encodeFunctionData({
    abi: APPROVE_ABI,
    functionName: 'approve',
    args: [TOKEN, SPENDER, amount, expiration],
  });
}

function permitCall(amount: bigint, expiration: bigint, deadline: bigint): Hex {
  return encodeFunctionData({
    abi: PERMIT_ABI,
    functionName: 'permit',
    args: [
      OWNER,
      { details: { token: TOKEN, amount, expiration, nonce: 7n }, spender: SPENDER, sigDeadline: deadline },
      SIGNATURE,
    ],
  });
}

function permitBatchCall(
  entries: { token: Hex; amount: bigint; expiration: bigint; nonce: bigint }[],
  deadline: bigint
): Hex {
  return encodeFunctionData({
    abi: PERMIT_BATCH_ABI,
    functionName: 'permit',
    args: [OWNER, { details: entries, spender: SPENDER, sigDeadline: deadline }, SIGNATURE],
  });
}

function transferCall(amount: bigint, requested: bigint, deadline: bigint): Hex {
  return encodeFunctionData({
    abi: TRANSFER_ABI,
    functionName: 'permitTransferFrom',
    args: [
      { permitted: { token: TOKEN, amount }, nonce: 3n, deadline },
      { to: RECIPIENT, requestedAmount: requested },
      OWNER,
      SIGNATURE,
    ],
  });
}

describe('Permit2 approve', () => {
  it('decodes a finite approval and flags unlimited or never-expiring grants', () => {
    const finite = decodePermit2Approve(approveCall(100n, EXPIRATION))!;
    expect(finite).toMatchObject({
      variant: 'approve',
      token: TOKEN,
      spender: SPENDER,
      owner: null,
      amount: 100n,
      expiration: EXPIRATION,
      isUnlimited: false,
      hasNoExpiry: false,
    });

    const unlimited = decodePermit2Approve(approveCall(MAX_UINT160, MAX_UINT48))!;
    expect(unlimited.isUnlimited).toBe(true);
    expect(unlimited.hasNoExpiry).toBe(true);

    const expiresNow = decodePermit2Approve(approveCall(100n, 0n))!;
    expect(expiresNow.hasNoExpiry).toBe(false);
    expect(expiresNow.expiration).toBe(0n);
  });

  it('returns null for a different selector and throws on a truncated payload', () => {
    expect(decodePermit2Approve('0x095ea7b3' + '00'.repeat(128))).toBeNull();
    expect(() => decodePermit2Approve('0x87517c45' + '00'.repeat(16))).toThrow(
      /Data too short/
    );
  });

  it('rejects a word that does not fit uint160 or uint48', () => {
    const hex = approveCall(100n, EXPIRATION).slice(2);
    const words = hex.slice(8);
    const high = (1n << 160n).toString(16).padStart(64, '0');
    const broken = `0x${hex.slice(0, 8)}${words.slice(0, 128)}${high}${words.slice(192)}`;
    expect(() => decodePermit2Approve(broken)).toThrow(/Invalid uint160/);
  });
});

describe('Permit2 permit and permit batch', () => {
  it('decodes a single permit, including unlimited and no-deadline cases', () => {
    const decoded = decodePermit2Permit(permitCall(50n, EXPIRATION, DEADLINE))!;
    expect(decoded).toMatchObject({
      variant: 'permit',
      owner: OWNER,
      spender: SPENDER,
      token: TOKEN,
      amount: 50n,
      expiration: EXPIRATION,
      deadline: DEADLINE,
      nonce: 7n,
      isUnlimited: false,
      hasNoExpiry: false,
    });

    const openSig = decodePermit2Permit(permitCall(50n, EXPIRATION, MAX_UINT256))!;
    expect(openSig.hasNoExpiry).toBe(true);
    expect(openSig.isUnlimited).toBe(false);

    const unlimited = decodePermit2Permit(permitCall(MAX_UINT160, MAX_UINT48, DEADLINE))!;
    expect(unlimited.isUnlimited).toBe(true);
    expect(unlimited.hasNoExpiry).toBe(true);
  });

  it('decodes a batch permit and flags a max amount on any entry', () => {
    const other = '0xdddddddddddddddddddddddddddddddddddddddd' as Hex;
    const decoded = decodePermit2PermitBatch(
      permitBatchCall(
        [
          { token: TOKEN, amount: 10n, expiration: EXPIRATION, nonce: 1n },
          { token: other, amount: MAX_UINT160, expiration: 1n, nonce: 2n },
        ],
        DEADLINE
      )
    )!;
    expect(decoded.variant).toBe('permit_batch');
    expect(decoded.spender).toBe(SPENDER);
    expect(decoded.allowances).toHaveLength(2);
    expect(decoded.allowances[1]).toMatchObject({
      token: other,
      amount: MAX_UINT160,
      nonce: 2n,
    });
    expect(decoded.isUnlimited).toBe(true);
    expect(decoded.hasNoExpiry).toBe(false);
  });

  it('throws on an empty batch and returns null for the wrong selector', () => {
    expect(decodePermit2PermitBatch(permitCall(1n, EXPIRATION, DEADLINE))).toBeNull();
    expect(() =>
      decodePermit2PermitBatch(permitBatchCall([], DEADLINE))
    ).toThrow(/empty/);
  });
});

describe('Permit2 permitTransferFrom', () => {
  it('decodes the signed cap, recipient, and deadline', () => {
    const decoded = decodePermit2PermitTransferFrom(
      transferCall(500n, 100n, DEADLINE)
    )!;
    expect(decoded).toMatchObject({
      variant: 'permit_transfer_from',
      owner: OWNER,
      spender: null,
      token: TOKEN,
      amount: 500n,
      to: RECIPIENT,
      requestedAmount: 100n,
      deadline: DEADLINE,
      nonce: 3n,
      isUnlimited: false,
      hasNoExpiry: false,
    });

    const unlimited = decodePermit2PermitTransferFrom(
      transferCall(MAX_UINT256, 1n, MAX_UINT256)
    )!;
    expect(unlimited.isUnlimited).toBe(true);
    expect(unlimited.hasNoExpiry).toBe(true);
  });
});

describe('decodePermit2', () => {
  it('dispatches each variant and returns null for unrelated calldata', () => {
    expect(decodePermit2(approveCall(1n, EXPIRATION))?.variant).toBe('approve');
    expect(decodePermit2(permitCall(1n, EXPIRATION, DEADLINE))?.variant).toBe(
      'permit'
    );
    expect(
      decodePermit2(
        permitBatchCall(
          [{ token: TOKEN, amount: 1n, expiration: EXPIRATION, nonce: 0n }],
          DEADLINE
        )
      )?.variant
    ).toBe('permit_batch');
    expect(decodePermit2(transferCall(1n, 1n, DEADLINE))?.variant).toBe(
      'permit_transfer_from'
    );
    expect(decodePermit2('0x095ea7b3' + '00'.repeat(128))).toBeNull();
    expect(PERMIT2_SIGNATURES.approve).toContain('uint160');
  });
});
