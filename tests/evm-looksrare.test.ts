import { describe, expect, it } from 'vitest';
import { encodeAbiParameters, encodeFunctionData, parseAbi, type Hex } from 'viem';
import {
  LOOKSRARE_SIGNATURES,
  MAX_LOOKSRARE_ITEMS,
  decodeLooksRare,
  isLooksRareNamedAddress,
  looksrareCollectionKind,
  looksrareCollectionOfferItemId,
  looksrareMerklePositionKind,
  looksrareQuoteKind,
  looksrareStrategyKind,
} from '../src/evm/looksrare';

const COLLECTION: Hex = '0xdddddddddddddddddddddddddddddddddddddddd';
const CURRENCY: Hex = '0xcccccccccccccccccccccccccccccccccccccccc';
const SIGNER: Hex = '0x1111111111111111111111111111111111111111';
const RECIPIENT: Hex = '0x3333333333333333333333333333333333333333';
const AFFILIATE: Hex = '0x4444444444444444444444444444444444444444';
const ZERO: Hex = '0x0000000000000000000000000000000000000000';
const MAKER_SIG: Hex = `0x${'11'.repeat(65)}`;
const MERKLE_ROOT: Hex = `0x${'ab'.repeat(32)}`;
const MERKLE_NODE: Hex = `0x${'cd'.repeat(32)}`;

const ERC20_ABI = parseAbi([
  'function approve(address spender, uint256 value)',
]);
const LOOKSRARE_ABI = parseAbi([
  'function executeTakerAsk((address recipient, bytes additionalParameters) takerAsk, (uint8 quoteType, uint256 globalNonce, uint256 subsetNonce, uint256 orderNonce, uint256 strategyId, uint8 collectionType, address collection, address currency, address signer, uint256 startTime, uint256 endTime, uint256 price, uint256[] itemIds, uint256[] amounts, bytes additionalParameters) makerBid, bytes makerSignature, (bytes32 root, (bytes32 value, uint8 position)[] proof) merkleTree, address affiliate)',
  'function executeTakerBid((address recipient, bytes additionalParameters) takerBid, (uint8 quoteType, uint256 globalNonce, uint256 subsetNonce, uint256 orderNonce, uint256 strategyId, uint8 collectionType, address collection, address currency, address signer, uint256 startTime, uint256 endTime, uint256 price, uint256[] itemIds, uint256[] amounts, bytes additionalParameters) makerAsk, bytes makerSignature, (bytes32 root, (bytes32 value, uint8 position)[] proof) merkleTree, address affiliate)',
  'function executeMultipleTakerBids((address recipient, bytes additionalParameters)[] takerBids, (uint8 quoteType, uint256 globalNonce, uint256 subsetNonce, uint256 orderNonce, uint256 strategyId, uint8 collectionType, address collection, address currency, address signer, uint256 startTime, uint256 endTime, uint256 price, uint256[] itemIds, uint256[] amounts, bytes additionalParameters)[] makerAsks, bytes[] makerSignatures, (bytes32 root, (bytes32 value, uint8 position)[] proof)[] merkleTrees, address affiliate, bool isAtomic)',
]);

const approve = encodeFunctionData({
  abi: ERC20_ABI,
  functionName: 'approve',
  args: [RECIPIENT, 5n],
});

const emptyMerkle = {
  root: `0x${'0'.repeat(64)}` as Hex,
  proof: [] as { value: Hex; position: number }[],
};

function maker(overrides: Partial<typeof baseMaker> = {}) {
  return { ...baseMaker, ...overrides };
}

const baseMaker = {
  quoteType: 1,
  globalNonce: 0n,
  subsetNonce: 0n,
  orderNonce: 1n,
  strategyId: 0n,
  collectionType: 0,
  collection: COLLECTION,
  currency: CURRENCY,
  signer: SIGNER,
  startTime: 1_700_000_000n,
  endTime: 1_900_000_000n,
  price: 10n,
  itemIds: [7n],
  amounts: [1n],
  additionalParameters: '0x' as Hex,
};

function taker(opts: { recipient?: Hex; additionalParameters?: Hex } = {}) {
  return {
    recipient: opts.recipient ?? RECIPIENT,
    additionalParameters: opts.additionalParameters ?? ('0x' as Hex),
  };
}

function merkle(opts: { root?: Hex; proof?: { value: Hex; position: number }[] } = {}) {
  return {
    root: opts.root ?? MERKLE_ROOT,
    proof: opts.proof ?? [{ value: MERKLE_NODE, position: 0 }],
  };
}

function executeTakerBid(
  opts: {
    maker?: Partial<typeof baseMaker>;
    taker?: { recipient?: Hex; additionalParameters?: Hex };
    merkle?: { root?: Hex; proof?: { value: Hex; position: number }[] };
    affiliate?: Hex;
  } = {}
): Hex {
  return encodeFunctionData({
    abi: LOOKSRARE_ABI,
    functionName: 'executeTakerBid',
    args: [
      taker(opts.taker),
      maker(opts.maker),
      MAKER_SIG,
      merkle(opts.merkle),
      opts.affiliate ?? AFFILIATE,
    ],
  });
}

function executeTakerAsk(
  opts: {
    maker?: Partial<typeof baseMaker>;
    taker?: { recipient?: Hex; additionalParameters?: Hex };
    affiliate?: Hex;
  } = {}
): Hex {
  return encodeFunctionData({
    abi: LOOKSRARE_ABI,
    functionName: 'executeTakerAsk',
    args: [
      taker(opts.taker),
      maker({ quoteType: 0, ...opts.maker }),
      MAKER_SIG,
      emptyMerkle,
      opts.affiliate ?? ZERO,
    ],
  });
}

function executeMultiple(
  fills: {
    maker?: Partial<typeof baseMaker>;
    taker?: { recipient?: Hex; additionalParameters?: Hex };
  }[],
  opts: { affiliate?: Hex; isAtomic?: boolean } = {}
): Hex {
  return encodeFunctionData({
    abi: LOOKSRARE_ABI,
    functionName: 'executeMultipleTakerBids',
    args: [
      fills.map((fill) => taker(fill.taker)),
      fills.map((fill) => maker(fill.maker)),
      fills.map(() => MAKER_SIG),
      fills.map(() => emptyMerkle),
      opts.affiliate ?? AFFILIATE,
      opts.isAtomic ?? true,
    ],
  });
}

describe('decodeLooksRare', () => {
  it('returns null for unrelated selectors and short input', () => {
    expect(decodeLooksRare(approve)).toBeNull();
    expect(decodeLooksRare('0x')).toBeNull();
    expect(decodeLooksRare('0xdeadbeef')).toBeNull();
  });

  it('rejects non-hex input', () => {
    expect(() => decodeLooksRare('zz')).toThrow(/Invalid hex data/);
  });

  it('decodes executeTakerBid with a standard maker ask', () => {
    const decoded = decodeLooksRare(executeTakerBid())!;
    expect(decoded.method).toBe('looksrare');
    expect(decoded.variant).toBe('execute_taker_bid');
    expect(decoded.signature).toBe(LOOKSRARE_SIGNATURES.execute_taker_bid);
    expect(decoded.affiliate).toBe(AFFILIATE);
    expect(decoded.isAtomic).toBeNull();
    expect(decoded.fills).toHaveLength(1);
    const fill = decoded.fills[0]!;
    expect(fill.index).toBe(0);
    expect(fill.taker.recipient).toBe(RECIPIENT);
    expect(fill.taker.additionalParameters).toBe('0x');
    expect(fill.taker.itemId).toBeNull();
    expect(fill.maker.quoteKind).toBe('ask');
    expect(fill.maker.quoteType).toBe(1);
    expect(fill.maker.strategyKind).toBe('standard');
    expect(fill.maker.strategyId).toBe(0n);
    expect(fill.maker.collectionKind).toBe('erc721');
    expect(fill.maker.collection).toBe(COLLECTION);
    expect(fill.maker.currency).toBe(CURRENCY);
    expect(fill.maker.signer).toBe(SIGNER);
    expect(fill.maker.startTime).toBe(1_700_000_000n);
    expect(fill.maker.endTime).toBe(1_900_000_000n);
    expect(fill.maker.price).toBe(10n);
    expect(fill.maker.itemIds).toEqual([7n]);
    expect(fill.maker.amounts).toEqual([1n]);
    expect(fill.maker.globalNonce).toBe(0n);
    expect(fill.maker.orderNonce).toBe(1n);
    expect(fill.makerSignature).toBe(MAKER_SIG);
    expect(fill.merkleTree.root).toBe(MERKLE_ROOT);
    expect(fill.merkleTree.proof).toEqual([
      { value: MERKLE_NODE, position: 0, positionKind: 'left' },
    ]);
  });

  it('decodes executeTakerAsk against a maker bid', () => {
    const decoded = decodeLooksRare(executeTakerAsk())!;
    expect(decoded.variant).toBe('execute_taker_ask');
    expect(decoded.signature).toBe(LOOKSRARE_SIGNATURES.execute_taker_ask);
    expect(decoded.affiliate).toBe(ZERO);
    expect(decoded.fills[0]!.maker.quoteKind).toBe('bid');
    expect(decoded.fills[0]!.maker.quoteType).toBe(0);
  });

  it('reads the token id from a collection-offer taker', () => {
    const additionalParameters = encodeAbiParameters(
      [{ type: 'uint256' }],
      [42n]
    );
    const decoded = decodeLooksRare(
      executeTakerAsk({
        maker: { strategyId: 1n, itemIds: [0n], amounts: [1n] },
        taker: { additionalParameters },
      })
    )!;
    const fill = decoded.fills[0]!;
    expect(fill.maker.strategyKind).toBe('collection_offer');
    expect(fill.taker.itemId).toBe(42n);
    expect(fill.taker.additionalParameters).toBe(additionalParameters);
  });

  it('decodes executeMultipleTakerBids and keeps isAtomic', () => {
    const decoded = decodeLooksRare(
      executeMultiple(
        [
          { taker: { recipient: RECIPIENT } },
          {
            maker: { itemIds: [8n], amounts: [1n], price: 11n },
            taker: { recipient: SIGNER },
          },
        ],
        { isAtomic: false }
      )
    )!;
    expect(decoded.variant).toBe('execute_multiple_taker_bids');
    expect(decoded.signature).toBe(
      LOOKSRARE_SIGNATURES.execute_multiple_taker_bids
    );
    expect(decoded.isAtomic).toBe(false);
    expect(decoded.fills).toHaveLength(2);
    expect(decoded.fills[0]!.taker.recipient).toBe(RECIPIENT);
    expect(decoded.fills[1]!.taker.recipient).toBe(SIGNER);
    expect(decoded.fills[1]!.maker.price).toBe(11n);
    expect(decoded.fills[1]!.index).toBe(1);
  });

  it('keeps unknown quote, collection, and strategy kinds decodable', () => {
    const decoded = decodeLooksRare(
      executeTakerBid({
        maker: { quoteType: 9, collectionType: 4, strategyId: 99n },
      })
    )!;
    const makerOrder = decoded.fills[0]!.maker;
    expect(makerOrder.quoteKind).toBe('unknown');
    expect(makerOrder.collectionKind).toBe('unknown');
    expect(makerOrder.strategyKind).toBe('unknown');
    expect(makerOrder.strategyId).toBe(99n);
  });

  it('rejects a fill list longer than the cap', () => {
    const data = executeMultiple(
      Array.from({ length: MAX_LOOKSRARE_ITEMS + 1 }, () => ({}))
    );
    expect(() => decodeLooksRare(data)).toThrow(/fills; the limit is 256/);
  });

  it('rejects an item-id list longer than the cap', () => {
    const data = executeTakerBid({
      maker: {
        itemIds: Array.from({ length: MAX_LOOKSRARE_ITEMS + 1 }, (_, i) =>
          BigInt(i)
        ),
        amounts: Array.from({ length: MAX_LOOKSRARE_ITEMS + 1 }, () => 1n),
      },
    });
    expect(() => decodeLooksRare(data)).toThrow(/item ids; the limit is 256/);
  });

  it('rejects mismatched item id and amount lengths', () => {
    const data = executeTakerBid({
      maker: { itemIds: [1n, 2n], amounts: [1n] },
    });
    expect(() => decodeLooksRare(data)).toThrow(
      /2 item ids and 1 amounts/
    );
  });

  it('rejects a truncated payload for a known selector', () => {
    const data = executeTakerBid();
    expect(() => decodeLooksRare(data.slice(0, 10))).toThrow(
      /Malformed arguments/
    );
  });
});

describe('looksrare helpers', () => {
  it('maps documented enums and treats zero as unnamed', () => {
    expect(looksrareQuoteKind(0)).toBe('bid');
    expect(looksrareQuoteKind(1)).toBe('ask');
    expect(looksrareQuoteKind(2)).toBe('unknown');
    expect(looksrareCollectionKind(0)).toBe('erc721');
    expect(looksrareCollectionKind(1)).toBe('erc1155');
    expect(looksrareCollectionKind(2)).toBe('unknown');
    expect(looksrareStrategyKind(0n)).toBe('standard');
    expect(looksrareStrategyKind(1n)).toBe('collection_offer');
    expect(looksrareStrategyKind(2n)).toBe('unknown');
    expect(looksrareMerklePositionKind(0)).toBe('left');
    expect(looksrareMerklePositionKind(1)).toBe('right');
    expect(looksrareMerklePositionKind(2)).toBe('unknown');
    expect(isLooksRareNamedAddress(RECIPIENT)).toBe(true);
    expect(isLooksRareNamedAddress(ZERO)).toBe(false);
    expect(isLooksRareNamedAddress(null)).toBe(false);
  });

  it('only reads a collection-offer item id from a 32-byte word', () => {
    const word = encodeAbiParameters([{ type: 'uint256' }], [7n]);
    expect(looksrareCollectionOfferItemId(1n, word)).toBe(7n);
    expect(looksrareCollectionOfferItemId(0n, word)).toBeNull();
    expect(looksrareCollectionOfferItemId(1n, '0x')).toBeNull();
    expect(looksrareCollectionOfferItemId(1n, '0x1234')).toBeNull();
  });
});
