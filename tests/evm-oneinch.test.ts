import { describe, expect, it } from 'vitest';
import { encodeFunctionData, parseAbi, type Hex } from 'viem';
import {
  MAX_ONEINCH_POOLS,
  ONEINCH_FLAG_PARTIAL_FILL,
  ONEINCH_FLAG_REQUIRES_EXTRA_ETH,
  ONEINCH_FLAG_SHOULD_CLAIM,
  ONEINCH_NATIVE_TOKEN,
  ONEINCH_SIGNATURES,
  decodeOneInch,
  extractOneInchPoolAddress,
  extractOneInchSwapFlags,
  isOneInchNativeToken,
} from '../src/evm/oneInch';

const TOKEN: Hex = '0xcccccccccccccccccccccccccccccccccccccccc';
const TOKEN_OUT: Hex = '0xdddddddddddddddddddddddddddddddddddddddd';
const EXECUTOR: Hex = '0x1111111111111111111111111111111111111111';
const SRC_RECEIVER: Hex = '0x2222222222222222222222222222222222222222';
const DST_RECEIVER: Hex = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const CLIPPER: Hex = '0x3333333333333333333333333333333333333333';
const POOL: Hex = '0x4444444444444444444444444444444444444444';
const PERMIT_R: Hex = `0x${'ab'.repeat(32)}`;
const PERMIT_S: Hex = `0x${'cd'.repeat(32)}`;
const CLIPPER_R: Hex = `0x${'11'.repeat(32)}`;
const CLIPPER_VS: Hex = `0x${'22'.repeat(32)}`;

const ERC20_ABI = parseAbi([
  'function approve(address spender, uint256 value)',
]);
const PERMIT_ABI = parseAbi([
  'function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)',
]);
const ONEINCH_ABI = parseAbi([
  'function swap(address executor, (address srcToken, address dstToken, address srcReceiver, address dstReceiver, uint256 amount, uint256 minReturnAmount, uint256 flags) desc, bytes permit, bytes data)',
  'function unoswapTo(address recipient, address srcToken, uint256 amount, uint256 minReturn, uint256[] pools)',
  'function unoswapToWithPermit(address recipient, address srcToken, uint256 amount, uint256 minReturn, uint256[] pools, bytes permit)',
  'function clipperSwapTo(address clipperExchange, address recipient, address srcToken, address dstToken, uint256 inputAmount, uint256 outputAmount, uint256 goodUntil, bytes32 r, bytes32 vs)',
  'function clipperSwapToWithPermit(address clipperExchange, address recipient, address srcToken, address dstToken, uint256 inputAmount, uint256 outputAmount, uint256 goodUntil, bytes32 r, bytes32 vs, bytes permit)',
]);

const approve = encodeFunctionData({
  abi: ERC20_ABI,
  functionName: 'approve',
  args: [DST_RECEIVER, 5n],
});

const permit = encodeFunctionData({
  abi: PERMIT_ABI,
  functionName: 'permit',
  args: [
    EXECUTOR,
    DST_RECEIVER,
    8n,
    1_900_000_000n,
    27,
    PERMIT_R,
    PERMIT_S,
  ],
});

function swapDesc(opts: {
  srcToken?: Hex;
  dstToken?: Hex;
  flags?: bigint;
  amount?: bigint;
  minReturn?: bigint;
} = {}) {
  return {
    srcToken: opts.srcToken ?? TOKEN,
    dstToken: opts.dstToken ?? TOKEN_OUT,
    srcReceiver: SRC_RECEIVER,
    dstReceiver: DST_RECEIVER,
    amount: opts.amount ?? 10n,
    minReturnAmount: opts.minReturn ?? 9n,
    flags: opts.flags ?? 0n,
  };
}

function swap(opts: {
  desc?: ReturnType<typeof swapDesc>;
  permit?: Hex;
  data?: Hex;
} = {}): Hex {
  return encodeFunctionData({
    abi: ONEINCH_ABI,
    functionName: 'swap',
    args: [
      EXECUTOR,
      opts.desc ?? swapDesc(),
      opts.permit ?? '0x',
      opts.data ?? '0x',
    ],
  });
}

describe('decodeOneInch', () => {
  it('returns null for unrelated selectors and short input', () => {
    expect(decodeOneInch(approve)).toBeNull();
    expect(decodeOneInch('0x')).toBeNull();
    expect(decodeOneInch('0xdeadbeef')).toBeNull();
  });

  it('rejects non-hex input', () => {
    expect(() => decodeOneInch('zz')).toThrow(/Invalid hex data/);
  });

  it('decodes swap with empty permit and executor data', () => {
    const decoded = decodeOneInch(swap())!;
    expect(decoded.method).toBe('oneinch');
    expect(decoded.variant).toBe('swap');
    expect(decoded.signature).toBe(ONEINCH_SIGNATURES.swap);
    expect(decoded.executor).toBe(EXECUTOR);
    expect(decoded.srcToken).toBe(TOKEN);
    expect(decoded.dstToken).toBe(TOKEN_OUT);
    expect(decoded.srcReceiver).toBe(SRC_RECEIVER);
    expect(decoded.dstReceiver).toBe(DST_RECEIVER);
    expect(decoded.amount).toBe(10n);
    expect(decoded.minReturn).toBe(9n);
    expect(decoded.flags).toBe(0n);
    expect(decoded.partialFill).toBe(false);
    expect(decoded.requiresExtraEth).toBe(false);
    expect(decoded.shouldClaim).toBe(false);
    expect(decoded.srcIsEth).toBe(false);
    expect(decoded.dstIsEth).toBe(false);
    expect(decoded.permit).toBe('0x');
    expect(decoded.executorData).toBe('0x');
    expect(decoded.recipient).toBeNull();
    expect(decoded.pools).toEqual([]);
  });

  it('keeps nested permit and executor calldata on swap', () => {
    const decoded = decodeOneInch(swap({ permit, data: approve }))!;
    expect(decoded.permit).toBe(permit);
    expect(decoded.executorData).toBe(approve);
  });

  it('unpacks swap flags and the native-ETH token sentinel', () => {
    const flags =
      ONEINCH_FLAG_PARTIAL_FILL |
      ONEINCH_FLAG_REQUIRES_EXTRA_ETH |
      ONEINCH_FLAG_SHOULD_CLAIM;
    const decoded = decodeOneInch(
      swap({
        desc: swapDesc({
          srcToken: ONEINCH_NATIVE_TOKEN,
          dstToken: TOKEN_OUT,
          flags,
        }),
      })
    )!;
    expect(decoded.partialFill).toBe(true);
    expect(decoded.requiresExtraEth).toBe(true);
    expect(decoded.shouldClaim).toBe(true);
    expect(decoded.srcIsEth).toBe(true);
    expect(decoded.dstIsEth).toBe(false);
    expect(isOneInchNativeToken(ONEINCH_NATIVE_TOKEN)).toBe(true);
    expect(isOneInchNativeToken(TOKEN)).toBe(false);
    expect(extractOneInchSwapFlags(flags)).toEqual({
      partialFill: true,
      requiresExtraEth: true,
      shouldClaim: true,
    });
  });

  it('decodes unoswapTo and recovers pool addresses from packed words', () => {
    const packed = (1n << 160n) | BigInt(POOL);
    const decoded = decodeOneInch(
      encodeFunctionData({
        abi: ONEINCH_ABI,
        functionName: 'unoswapTo',
        args: [DST_RECEIVER, TOKEN, 10n, 9n, [packed]],
      })
    )!;
    expect(decoded.variant).toBe('unoswap_to');
    expect(decoded.signature).toBe(ONEINCH_SIGNATURES.unoswap_to);
    expect(decoded.recipient).toBe(DST_RECEIVER);
    expect(decoded.srcToken).toBe(TOKEN);
    expect(decoded.amount).toBe(10n);
    expect(decoded.minReturn).toBe(9n);
    expect(decoded.pools).toEqual([
      `0x${packed.toString(16).padStart(64, '0')}`,
    ]);
    expect(decoded.poolAddresses).toEqual([POOL]);
    expect(extractOneInchPoolAddress(packed)).toBe(POOL);
    expect(decoded.executor).toBeNull();
    expect(decoded.permit).toBe('0x');
  });

  it('decodes unoswapToWithPermit', () => {
    const decoded = decodeOneInch(
      encodeFunctionData({
        abi: ONEINCH_ABI,
        functionName: 'unoswapToWithPermit',
        args: [DST_RECEIVER, TOKEN, 4n, 3n, [BigInt(POOL)], permit],
      })
    )!;
    expect(decoded.variant).toBe('unoswap_to_with_permit');
    expect(decoded.signature).toBe(ONEINCH_SIGNATURES.unoswap_to_with_permit);
    expect(decoded.permit).toBe(permit);
    expect(decoded.poolAddresses).toEqual([POOL]);
  });

  it('decodes clipperSwapTo and clipperSwapToWithPermit', () => {
    const clipper = decodeOneInch(
      encodeFunctionData({
        abi: ONEINCH_ABI,
        functionName: 'clipperSwapTo',
        args: [
          CLIPPER,
          DST_RECEIVER,
          TOKEN,
          TOKEN_OUT,
          10n,
          9n,
          1_900_000_000n,
          CLIPPER_R,
          CLIPPER_VS,
        ],
      })
    )!;
    expect(clipper.variant).toBe('clipper_swap_to');
    expect(clipper.signature).toBe(ONEINCH_SIGNATURES.clipper_swap_to);
    expect(clipper.clipperExchange).toBe(CLIPPER);
    expect(clipper.recipient).toBe(DST_RECEIVER);
    expect(clipper.srcToken).toBe(TOKEN);
    expect(clipper.dstToken).toBe(TOKEN_OUT);
    expect(clipper.amount).toBe(10n);
    expect(clipper.minReturn).toBe(9n);
    expect(clipper.goodUntil).toBe(1_900_000_000);
    expect(clipper.clipperR).toBe(CLIPPER_R);
    expect(clipper.clipperVs).toBe(CLIPPER_VS);
    expect(clipper.permit).toBe('0x');

    const withPermit = decodeOneInch(
      encodeFunctionData({
        abi: ONEINCH_ABI,
        functionName: 'clipperSwapToWithPermit',
        args: [
          CLIPPER,
          DST_RECEIVER,
          TOKEN,
          ONEINCH_NATIVE_TOKEN,
          10n,
          9n,
          1_900_000_000n,
          CLIPPER_R,
          CLIPPER_VS,
          permit,
        ],
      })
    )!;
    expect(withPermit.variant).toBe('clipper_swap_to_with_permit');
    expect(withPermit.dstIsEth).toBe(true);
    expect(withPermit.permit).toBe(permit);
  });

  it('throws when the selector matches but the payload is truncated', () => {
    expect(() => decodeOneInch('0x12aa3caf0001')).toThrow(
      /Malformed arguments for swap/
    );
  });

  it('throws when there are too many unoswap pools', () => {
    const many = Array.from({ length: MAX_ONEINCH_POOLS + 1 }, () => 1n);
    expect(() =>
      decodeOneInch(
        encodeFunctionData({
          abi: ONEINCH_ABI,
          functionName: 'unoswapTo',
          args: [DST_RECEIVER, TOKEN, 1n, 1n, many],
        })
      )
    ).toThrow(/limit is 256/);
  });
});
