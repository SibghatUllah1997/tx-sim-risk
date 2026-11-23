import { describe, expect, it } from 'vitest';
import { encodeFunctionData, parseAbi, type Hex } from 'viem';
import {
  UNLIMITED_APPROVAL_RISK,
  formatDetectedHeader,
  generateJsonReport,
  isValidReport,
} from '../src';

const TOKEN: Hex = '0xcccccccccccccccccccccccccccccccccccccccc';
const TOKEN_OUT: Hex = '0xdddddddddddddddddddddddddddddddddddddddd';
const ROUTER: Hex = '0x7a250d5630b4cf539739df2c5dacb4c659f2488d';
const RECEIVER: Hex = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const ZERO: Hex = '0x0000000000000000000000000000000000000000';
const APP_DATA: Hex = `0x${'11'.repeat(32)}`;
const SIG: Hex = '0xabcd';
const MAX_UINT256 = (1n << 256n) - 1n;
const ORDER_UID: Hex = `0x${'ab'.repeat(56)}`;

const ERC20_ABI = parseAbi([
  'function approve(address spender, uint256 value)',
  'function transfer(address to, uint256 value)',
]);
const COW_ABI = parseAbi([
  'function settle(address[] tokens, uint256[] clearingPrices, (uint256 sellTokenIndex, uint256 buyTokenIndex, address receiver, uint256 sellAmount, uint256 buyAmount, uint32 validTo, bytes32 appData, uint256 feeAmount, uint256 flags, uint256 executedAmount, bytes signature)[] trades, (address target, uint256 value, bytes callData)[][3] interactions)',
  'function setPreSignature(bytes orderUid, bool signed)',
  'function invalidateOrder(bytes orderUid)',
]);

function approve(spender: Hex, value: bigint): Hex {
  return encodeFunctionData({
    abi: ERC20_ABI,
    functionName: 'approve',
    args: [spender, value],
  });
}

function transfer(to: Hex, value: bigint): Hex {
  return encodeFunctionData({
    abi: ERC20_ABI,
    functionName: 'transfer',
    args: [to, value],
  });
}

function trade(receiver: Hex = RECEIVER) {
  return {
    sellTokenIndex: 0n,
    buyTokenIndex: 1n,
    receiver,
    sellAmount: 10n,
    buyAmount: 9n,
    validTo: 1_900_000_000,
    appData: APP_DATA,
    feeAmount: 1n,
    flags: 0n,
    executedAmount: 0n,
    signature: SIG,
  };
}

function settle(opts: {
  trades?: ReturnType<typeof trade>[];
  interactions?: [
    { target: Hex; value: bigint; callData: Hex }[],
    { target: Hex; value: bigint; callData: Hex }[],
    { target: Hex; value: bigint; callData: Hex }[],
  ];
} = {}): Hex {
  return encodeFunctionData({
    abi: COW_ABI,
    functionName: 'settle',
    args: [
      [TOKEN, TOKEN_OUT],
      [1n, 2n],
      opts.trades ?? [trade()],
      opts.interactions ?? [[], [], []],
    ],
  });
}

describe('cowswap reports', () => {
  it('nests an inner approve and rolls its unlimited-approval risk up', () => {
    const report = generateJsonReport(
      settle({
        interactions: [
          [{ target: TOKEN, value: 0n, callData: approve(ROUTER, MAX_UINT256) }],
          [],
          [],
        ],
      })
    )!;
    expect(report.type).toBe('cowswap');
    if (report.type !== 'cowswap') return;
    expect(report.payload.variant).toBe('settle');
    expect(report.payload.tokens).toEqual([TOKEN, TOKEN_OUT]);
    expect(report.payload.trades).toHaveLength(1);
    expect(report.payload.trades[0]!.receiver).toBe(RECEIVER);
    expect(report.payload.trades[0]!.kind).toBe('sell');
    expect(report.payload.interactions).toHaveLength(1);
    const inner = report.payload.interactions[0]!;
    expect(inner.stage).toBe('pre');
    expect(inner.target).toBe(TOKEN);
    expect(inner.innerReport?.type).toBe('erc20_approve');
    expect(inner.innerReport?.risks).toEqual([UNLIMITED_APPROVAL_RISK]);
    expect(report.risks).toEqual([UNLIMITED_APPROVAL_RISK]);
    expect(report.severity).toBe('high');
    expect(inner.depthLimited).toBe(false);
    expect(isValidReport(report)).toBe(true);
  });

  it('keeps a plain inner transfer as info and records the settle simulation note', () => {
    const report = generateJsonReport(
      settle({
        interactions: [
          [],
          [{ target: TOKEN, value: 0n, callData: transfer(RECEIVER, 9n) }],
          [],
        ],
      })
    )!;
    expect(report.type).toBe('cowswap');
    if (report.type !== 'cowswap') return;
    expect(report.payload.interactions[0]!.stage).toBe('intra');
    expect(report.payload.interactions[0]!.innerReport?.type).toBe(
      'erc20_transfer'
    );
    expect(report.risks).toEqual([]);
    expect(report.severity).toBe('info');
    expect(
      report.simulation.notes.some((n) => /GPv2Settlement contract/.test(n))
    ).toBe(true);
    expect(isValidReport(report)).toBe(true);
  });

  it('lists tokens, trades, and interactions in the text header', () => {
    const report = generateJsonReport(settle())!;
    expect(report.type).toBe('cowswap');
    expect(formatDetectedHeader(report)).toEqual([
      'Detected: CowSwap settle(address[],uint256[],(uint256,uint256,address,uint256,uint256,uint32,bytes32,uint256,uint256,uint256,bytes)[],(address,uint256,bytes)[][3])',
      'Tokens: 2',
      'Trades: 1',
      'Interactions: 0',
    ]);
    expect(isValidReport(report)).toBe(true);
  });

  it('decodes setPreSignature without nested trades', () => {
    const report = generateJsonReport(
      encodeFunctionData({
        abi: COW_ABI,
        functionName: 'setPreSignature',
        args: [ORDER_UID, true],
      })
    )!;
    expect(report.type).toBe('cowswap');
    if (report.type !== 'cowswap') return;
    expect(report.payload.variant).toBe('set_presignature');
    expect(report.payload.orderUid).toBe(ORDER_UID);
    expect(report.payload.signed).toBe(true);
    expect(report.payload.trades).toEqual([]);
    expect(report.payload.interactions).toEqual([]);
    expect(report.risks).toEqual([]);
    expect(formatDetectedHeader(report)).toEqual([
      'Detected: CowSwap setPreSignature(bytes,bool)',
      `Order UID: ${ORDER_UID}`,
      'Signed: yes',
    ]);
    expect(
      report.simulation.notes.some((n) => /setPreSignature marks an order/.test(n))
    ).toBe(true);
    expect(isValidReport(report)).toBe(true);
  });

  it('decodes invalidateOrder', () => {
    const report = generateJsonReport(
      encodeFunctionData({
        abi: COW_ABI,
        functionName: 'invalidateOrder',
        args: [ORDER_UID],
      })
    )!;
    expect(report.type).toBe('cowswap');
    if (report.type !== 'cowswap') return;
    expect(report.payload.variant).toBe('invalidate_order');
    expect(report.payload.orderUid).toBe(ORDER_UID);
    expect(report.payload.signed).toBeNull();
    expect(report.risks).toEqual([]);
    expect(isValidReport(report)).toBe(true);
  });

  it('treats a zero trade receiver as the order owner', () => {
    const report = generateJsonReport(settle({ trades: [trade(ZERO)] }))!;
    expect(report.type).toBe('cowswap');
    if (report.type !== 'cowswap') return;
    expect(report.payload.trades[0]!.receiverIsOwner).toBe(true);
    expect(report.payload.trades[0]!.receiverKind).toBeNull();
    expect(report.payload.trades[0]!.receiverLabel).toBeNull();
    expect(isValidReport(report)).toBe(true);
  });
});
