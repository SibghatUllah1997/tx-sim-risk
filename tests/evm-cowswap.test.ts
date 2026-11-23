import { describe, expect, it } from 'vitest';
import { encodeFunctionData, parseAbi, type Hex } from 'viem';
import {
  COWSWAP_SIGNATURES,
  MAX_COWSWAP_INTERACTIONS,
  MAX_COWSWAP_TRADES,
  decodeCowswap,
  extractCowswapFlags,
  isCowswapOwnerReceiver,
} from '../src/evm/cowswap';

const TOKEN: Hex = '0xcccccccccccccccccccccccccccccccccccccccc';
const TOKEN_OUT: Hex = '0xdddddddddddddddddddddddddddddddddddddddd';
const RECEIVER: Hex = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const ZERO: Hex = '0x0000000000000000000000000000000000000000';
const APP_DATA: Hex = `0x${'11'.repeat(32)}`;
const SIG: Hex = '0xabcd';

const ERC20_ABI = parseAbi([
  'function approve(address spender, uint256 value)',
]);
const COW_ABI = parseAbi([
  'function settle(address[] tokens, uint256[] clearingPrices, (uint256 sellTokenIndex, uint256 buyTokenIndex, address receiver, uint256 sellAmount, uint256 buyAmount, uint32 validTo, bytes32 appData, uint256 feeAmount, uint256 flags, uint256 executedAmount, bytes signature)[] trades, (address target, uint256 value, bytes callData)[][3] interactions)',
  'function setPreSignature(bytes orderUid, bool signed)',
  'function invalidateOrder(bytes orderUid)',
]);

const approve = encodeFunctionData({
  abi: ERC20_ABI,
  functionName: 'approve',
  args: [RECEIVER, 5n],
});

function trade(opts: {
  receiver?: Hex;
  flags?: bigint;
  sellTokenIndex?: bigint;
  buyTokenIndex?: bigint;
  sellAmount?: bigint;
  buyAmount?: bigint;
} = {}) {
  return {
    sellTokenIndex: opts.sellTokenIndex ?? 0n,
    buyTokenIndex: opts.buyTokenIndex ?? 1n,
    receiver: opts.receiver ?? RECEIVER,
    sellAmount: opts.sellAmount ?? 10n,
    buyAmount: opts.buyAmount ?? 9n,
    validTo: 1_900_000_000,
    appData: APP_DATA,
    feeAmount: 1n,
    flags: opts.flags ?? 0n,
    executedAmount: 0n,
    signature: SIG,
  };
}

function settle(opts: {
  tokens?: Hex[];
  prices?: bigint[];
  trades?: ReturnType<typeof trade>[];
  interactions?: [
    { target: Hex; value: bigint; callData: Hex }[],
    { target: Hex; value: bigint; callData: Hex }[],
    { target: Hex; value: bigint; callData: Hex }[],
  ];
} = {}): Hex {
  const tokens = opts.tokens ?? [TOKEN, TOKEN_OUT];
  return encodeFunctionData({
    abi: COW_ABI,
    functionName: 'settle',
    args: [
      tokens,
      opts.prices ?? tokens.map((_, i) => BigInt(i + 1)),
      opts.trades ?? [trade()],
      opts.interactions ?? [[], [], []],
    ],
  });
}

describe('decodeCowswap', () => {
  it('returns null for unrelated selectors and short input', () => {
    expect(decodeCowswap(approve)).toBeNull();
    expect(decodeCowswap('0x')).toBeNull();
    expect(decodeCowswap('0x13d79a')).toBeNull();
  });

  it('rejects non-hex input', () => {
    expect(() => decodeCowswap('zz')).toThrow(/Invalid hex data/);
  });

  it('decodes settle with a sell trade and empty interactions', () => {
    const decoded = decodeCowswap(settle())!;
    expect(decoded.method).toBe('cowswap');
    expect(decoded.variant).toBe('settle');
    expect(decoded.signature).toBe(COWSWAP_SIGNATURES.settle);
    expect(decoded.tokens).toEqual([TOKEN, TOKEN_OUT]);
    expect(decoded.clearingPrices).toEqual([1n, 2n]);
    expect(decoded.trades).toHaveLength(1);
    const first = decoded.trades[0]!;
    expect(first.sellTokenIndex).toBe(0);
    expect(first.buyTokenIndex).toBe(1);
    expect(first.receiver).toBe(RECEIVER);
    expect(first.receiverIsOwner).toBe(false);
    expect(first.sellAmount).toBe(10n);
    expect(first.buyAmount).toBe(9n);
    expect(first.validTo).toBe(1_900_000_000);
    expect(first.appData).toBe(APP_DATA);
    expect(first.feeAmount).toBe(1n);
    expect(first.kind).toBe('sell');
    expect(first.partiallyFillable).toBe(false);
    expect(first.sellTokenBalance).toBe('erc20');
    expect(first.buyTokenBalance).toBe('erc20');
    expect(first.signingScheme).toBe('eip712');
    expect(first.signature).toBe(SIG);
    expect(decoded.interactions).toEqual([]);
    expect(decoded.orderUid).toBeNull();
    expect(decoded.signed).toBeNull();
  });

  it('unpacks buy, partial-fill, internal balance, and pre-sign flags', () => {
    // bit0 buy, bit1 partial, bits2-3 sell internal (2), bits4-5 buy internal (2), bits6-7 presign (3)
    const flags = 1n | 2n | (2n << 2n) | (2n << 4n) | (3n << 6n);
    const decoded = decodeCowswap(settle({ trades: [trade({ flags })] }))!;
    const first = decoded.trades[0]!;
    expect(first.kind).toBe('buy');
    expect(first.partiallyFillable).toBe(true);
    expect(first.sellTokenBalance).toBe('internal');
    expect(first.buyTokenBalance).toBe('internal');
    expect(first.signingScheme).toBe('presign');
    expect(extractCowswapFlags(flags)).toMatchObject({
      kind: 'buy',
      signingScheme: 'presign',
    });
  });

  it('treats a zero receiver as the order owner', () => {
    const decoded = decodeCowswap(settle({ trades: [trade({ receiver: ZERO })] }))!;
    expect(decoded.trades[0]!.receiver).toBe(ZERO);
    expect(decoded.trades[0]!.receiverIsOwner).toBe(true);
    expect(isCowswapOwnerReceiver(ZERO)).toBe(true);
    expect(isCowswapOwnerReceiver(RECEIVER)).toBe(false);
  });

  it('decodes pre, intra, and post interactions in order', () => {
    const decoded = decodeCowswap(
      settle({
        interactions: [
          [{ target: TOKEN, value: 0n, callData: approve }],
          [{ target: RECEIVER, value: 7n, callData: '0x' }],
          [{ target: TOKEN_OUT, value: 0n, callData: '0xabcd' }],
        ],
      })
    )!;
    expect(decoded.interactions).toHaveLength(3);
    expect(decoded.interactions[0]).toMatchObject({
      index: 0,
      stage: 'pre',
      stageIndex: 0,
      target: TOKEN,
      value: 0n,
      data: approve,
    });
    expect(decoded.interactions[1]).toMatchObject({
      index: 1,
      stage: 'intra',
      stageIndex: 0,
      target: RECEIVER,
      value: 7n,
      data: '0x',
    });
    expect(decoded.interactions[2]).toMatchObject({
      index: 2,
      stage: 'post',
      stageIndex: 0,
      target: TOKEN_OUT,
      data: '0xabcd',
    });
  });

  it('decodes setPreSignature and invalidateOrder', () => {
    const uid: Hex = `0x${'ab'.repeat(56)}`;
    const pre = decodeCowswap(
      encodeFunctionData({
        abi: COW_ABI,
        functionName: 'setPreSignature',
        args: [uid, true],
      })
    )!;
    expect(pre.variant).toBe('set_presignature');
    expect(pre.signature).toBe(COWSWAP_SIGNATURES.set_presignature);
    expect(pre.orderUid).toBe(uid);
    expect(pre.signed).toBe(true);
    expect(pre.trades).toEqual([]);

    const cancel = decodeCowswap(
      encodeFunctionData({
        abi: COW_ABI,
        functionName: 'setPreSignature',
        args: [uid, false],
      })
    )!;
    expect(cancel.signed).toBe(false);

    const invalidated = decodeCowswap(
      encodeFunctionData({
        abi: COW_ABI,
        functionName: 'invalidateOrder',
        args: [uid],
      })
    )!;
    expect(invalidated.variant).toBe('invalidate_order');
    expect(invalidated.signature).toBe(COWSWAP_SIGNATURES.invalidate_order);
    expect(invalidated.orderUid).toBe(uid);
    expect(invalidated.signed).toBeNull();
  });

  it('throws when the selector matches but the payload is truncated', () => {
    expect(() => decodeCowswap('0x13d79a0b0001')).toThrow(
      /Malformed arguments for settle/
    );
  });

  it('throws when a trade index is outside the token list', () => {
    expect(() =>
      decodeCowswap(settle({ trades: [trade({ buyTokenIndex: 9n })] }))
    ).toThrow(/Malformed arguments for settle/);
  });

  it('throws when clearing prices do not match the token list', () => {
    expect(() => decodeCowswap(settle({ prices: [1n] }))).toThrow(
      /Malformed arguments for settle/
    );
  });

  it('throws when buy-side balance is external (invalid on GPv2)', () => {
    const flags = 1n << 4n;
    expect(() => decodeCowswap(settle({ trades: [trade({ flags })] }))).toThrow(
      /Malformed arguments for settle/
    );
  });

  it('throws when there are too many trades or interactions', () => {
    const manyTrades = Array.from({ length: MAX_COWSWAP_TRADES + 1 }, () =>
      trade()
    );
    expect(() => decodeCowswap(settle({ trades: manyTrades }))).toThrow(
      /limit is 256/
    );

    const one: { target: Hex; value: bigint; callData: Hex } = {
      target: TOKEN,
      value: 0n,
      callData: '0x',
    };
    const overflow = Array.from(
      { length: MAX_COWSWAP_INTERACTIONS + 1 },
      () => one
    );
    expect(() =>
      decodeCowswap(
        settle({
          trades: [trade()],
          interactions: [overflow, [], []],
        })
      )
    ).toThrow(/limit is 256/);
  });
});
