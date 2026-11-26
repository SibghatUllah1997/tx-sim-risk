import { describe, expect, it } from 'vitest';
import { encodeFunctionData, parseAbi, type Hex } from 'viem';
import {
  MAX_SEAPORT_ADDITIONAL_RECIPIENTS,
  MAX_SEAPORT_ITEMS,
  SEAPORT_SIGNATURES,
  decodeSeaport,
  isSeaportNamedRecipient,
  seaportBasicRoute,
  seaportItemKind,
  seaportOrderKind,
} from '../src/evm/seaport';

const TOKEN: Hex = '0xcccccccccccccccccccccccccccccccccccccccc';
const NFT: Hex = '0xdddddddddddddddddddddddddddddddddddddddd';
const OFFERER: Hex = '0x1111111111111111111111111111111111111111';
const ZONE: Hex = '0x2222222222222222222222222222222222222222';
const RECIPIENT: Hex = '0x3333333333333333333333333333333333333333';
const FEE: Hex = '0x4444444444444444444444444444444444444444';
const ZERO: Hex = '0x0000000000000000000000000000000000000000';
const ZONE_HASH: Hex = `0x${'ab'.repeat(32)}`;
const CONDUIT: Hex = `0x${'cd'.repeat(32)}`;
const ORDER_SIG: Hex = `0x${'11'.repeat(65)}`;

const ERC20_ABI = parseAbi([
  'function approve(address spender, uint256 value)',
]);
const SEAPORT_ABI = parseAbi([
  'function fulfillOrder(((address offerer, address zone, (uint8 itemType, address token, uint256 identifierOrCriteria, uint256 startAmount, uint256 endAmount)[] offer, (uint8 itemType, address token, uint256 identifierOrCriteria, uint256 startAmount, uint256 endAmount, address recipient)[] consideration, uint8 orderType, uint256 startTime, uint256 endTime, bytes32 zoneHash, uint256 salt, bytes32 conduitKey, uint256 totalOriginalConsiderationItems) parameters, bytes signature) order, bytes32 fulfillerConduitKey)',
  'function fulfillAdvancedOrder(((address offerer, address zone, (uint8 itemType, address token, uint256 identifierOrCriteria, uint256 startAmount, uint256 endAmount)[] offer, (uint8 itemType, address token, uint256 identifierOrCriteria, uint256 startAmount, uint256 endAmount, address recipient)[] consideration, uint8 orderType, uint256 startTime, uint256 endTime, bytes32 zoneHash, uint256 salt, bytes32 conduitKey, uint256 totalOriginalConsiderationItems) parameters, uint120 numerator, uint120 denominator, bytes signature, bytes extraData) advancedOrder, (uint256 orderIndex, uint8 side, uint256 index, uint256 identifier, bytes32[] criteriaProof)[] criteriaResolvers, bytes32 fulfillerConduitKey, address recipient)',
  'function fulfillBasicOrder((address considerationToken, uint256 considerationIdentifier, uint256 considerationAmount, address offerer, address zone, address offerToken, uint256 offerIdentifier, uint256 offerAmount, uint8 basicOrderType, uint256 startTime, uint256 endTime, bytes32 zoneHash, uint256 salt, bytes32 offererConduitKey, bytes32 fulfillerConduitKey, uint256 totalOriginalAdditionalRecipients, (uint256 amount, address recipient)[] additionalRecipients, bytes signature) parameters)',
  'function fulfillBasicOrder_efficient_6GL6yc((address considerationToken, uint256 considerationIdentifier, uint256 considerationAmount, address offerer, address zone, address offerToken, uint256 offerIdentifier, uint256 offerAmount, uint8 basicOrderType, uint256 startTime, uint256 endTime, bytes32 zoneHash, uint256 salt, bytes32 offererConduitKey, bytes32 fulfillerConduitKey, uint256 totalOriginalAdditionalRecipients, (uint256 amount, address recipient)[] additionalRecipients, bytes signature) parameters)',
]);

const approve = encodeFunctionData({
  abi: ERC20_ABI,
  functionName: 'approve',
  args: [RECIPIENT, 5n],
});

const offerNft = {
  itemType: 2,
  token: NFT,
  identifierOrCriteria: 7n,
  startAmount: 1n,
  endAmount: 1n,
};

const considerEth = {
  itemType: 0,
  token: ZERO,
  identifierOrCriteria: 0n,
  startAmount: 10n,
  endAmount: 10n,
  recipient: OFFERER,
};

function orderParams(overrides: Partial<typeof baseParams> = {}) {
  return { ...baseParams, ...overrides };
}

const baseParams = {
  offerer: OFFERER,
  zone: ZONE,
  offer: [offerNft],
  consideration: [considerEth],
  orderType: 0,
  startTime: 1_700_000_000n,
  endTime: 1_900_000_000n,
  zoneHash: ZONE_HASH,
  salt: 9n,
  conduitKey: CONDUIT,
  totalOriginalConsiderationItems: 1n,
};

function fulfillOrder(
  opts: {
    consideration?: typeof considerEth[];
    offer?: typeof offerNft[];
  } = {}
): Hex {
  return encodeFunctionData({
    abi: SEAPORT_ABI,
    functionName: 'fulfillOrder',
    args: [
      {
        parameters: orderParams({
          offer: opts.offer ?? [offerNft],
          consideration: opts.consideration ?? [considerEth],
          totalOriginalConsiderationItems: BigInt(
            (opts.consideration ?? [considerEth]).length
          ),
        }),
        signature: ORDER_SIG,
      },
      CONDUIT,
    ],
  });
}

function fulfillAdvanced(extraData: Hex = '0x'): Hex {
  return encodeFunctionData({
    abi: SEAPORT_ABI,
    functionName: 'fulfillAdvancedOrder',
    args: [
      {
        parameters: orderParams(),
        numerator: 1n,
        denominator: 1n,
        signature: ORDER_SIG,
        extraData,
      },
      [
        {
          orderIndex: 0n,
          side: 0,
          index: 0n,
          identifier: 7n,
          criteriaProof: [`0x${'ee'.repeat(32)}` as Hex],
        },
      ],
      CONDUIT,
      RECIPIENT,
    ],
  });
}

function basicParams(opts: {
  basicOrderType?: number;
  additionalRecipients?: { amount: bigint; recipient: Hex }[];
} = {}) {
  return {
    considerationToken: ZERO,
    considerationIdentifier: 0n,
    considerationAmount: 10n,
    offerer: OFFERER,
    zone: ZONE,
    offerToken: NFT,
    offerIdentifier: 7n,
    offerAmount: 1n,
    basicOrderType: opts.basicOrderType ?? 0,
    startTime: 1_700_000_000n,
    endTime: 1_900_000_000n,
    zoneHash: ZONE_HASH,
    salt: 9n,
    offererConduitKey: CONDUIT,
    fulfillerConduitKey: CONDUIT,
    totalOriginalAdditionalRecipients: BigInt(
      (opts.additionalRecipients ?? []).length
    ),
    additionalRecipients: opts.additionalRecipients ?? [],
    signature: ORDER_SIG,
  };
}

describe('decodeSeaport', () => {
  it('returns null for unrelated selectors and short input', () => {
    expect(decodeSeaport(approve)).toBeNull();
    expect(decodeSeaport('0x')).toBeNull();
    expect(decodeSeaport('0xdeadbeef')).toBeNull();
  });

  it('rejects non-hex input', () => {
    expect(() => decodeSeaport('zz')).toThrow(/Invalid hex data/);
  });

  it('decodes fulfillOrder with offer and consideration items', () => {
    const decoded = decodeSeaport(fulfillOrder())!;
    expect(decoded.method).toBe('seaport');
    expect(decoded.variant).toBe('fulfill_order');
    expect(decoded.signature).toBe(SEAPORT_SIGNATURES.fulfill_order);
    expect(decoded.offerer).toBe(OFFERER);
    expect(decoded.zone).toBe(ZONE);
    expect(decoded.orderKind).toBe('full_open');
    expect(decoded.orderType).toBe(0);
    expect(decoded.startTime).toBe(1_700_000_000n);
    expect(decoded.endTime).toBe(1_900_000_000n);
    expect(decoded.salt).toBe(9n);
    expect(decoded.zoneHash).toBe(ZONE_HASH);
    expect(decoded.conduitKey).toBe(CONDUIT);
    expect(decoded.fulfillerConduitKey).toBe(CONDUIT);
    expect(decoded.orderSignature).toBe(ORDER_SIG);
    expect(decoded.extraData).toBe('0x');
    expect(decoded.offer).toEqual([
      {
        index: 0,
        itemType: 2,
        itemKind: 'erc721',
        token: NFT,
        identifier: 7n,
        startAmount: 1n,
        endAmount: 1n,
      },
    ]);
    expect(decoded.consideration).toEqual([
      {
        index: 0,
        itemType: 0,
        itemKind: 'native',
        token: ZERO,
        identifier: 0n,
        startAmount: 10n,
        endAmount: 10n,
        recipient: OFFERER,
      },
    ]);
  });

  it('decodes fulfillAdvancedOrder extraData and criteria resolvers', () => {
    const decoded = decodeSeaport(fulfillAdvanced(approve))!;
    expect(decoded.variant).toBe('fulfill_advanced_order');
    expect(decoded.signature).toBe(SEAPORT_SIGNATURES.fulfill_advanced_order);
    expect(decoded.numerator).toBe(1n);
    expect(decoded.denominator).toBe(1n);
    expect(decoded.extraData).toBe(approve);
    expect(decoded.recipient).toBe(RECIPIENT);
    expect(decoded.criteriaResolvers).toEqual([
      {
        index: 0,
        orderIndex: 0n,
        side: 'offer',
        itemIndex: 0n,
        identifier: 7n,
        criteriaProof: [`0x${'ee'.repeat(32)}`],
      },
    ]);
  });

  it('decodes fulfillBasicOrder and expands additional recipients', () => {
    const decoded = decodeSeaport(
      encodeFunctionData({
        abi: SEAPORT_ABI,
        functionName: 'fulfillBasicOrder',
        args: [
          basicParams({
            additionalRecipients: [{ amount: 1n, recipient: FEE }],
          }),
        ],
      })
    )!;
    expect(decoded.variant).toBe('fulfill_basic_order');
    expect(decoded.signature).toBe(SEAPORT_SIGNATURES.fulfill_basic_order);
    expect(decoded.basicOrderType).toBe(0);
    expect(decoded.basicRoute).toBe('eth_to_erc721');
    expect(decoded.orderKind).toBe('full_open');
    expect(decoded.offer[0]?.itemKind).toBe('erc721');
    expect(decoded.offer[0]?.token).toBe(NFT);
    expect(decoded.consideration).toHaveLength(2);
    expect(decoded.consideration[0]?.recipient).toBe(OFFERER);
    expect(decoded.consideration[0]?.itemKind).toBe('native');
    expect(decoded.consideration[1]?.recipient).toBe(FEE);
    expect(decoded.consideration[1]?.startAmount).toBe(1n);
    expect(decoded.additionalRecipients).toEqual([
      { index: 0, amount: 1n, recipient: FEE },
    ]);
  });

  it('decodes the efficient basic-order selector', () => {
    const decoded = decodeSeaport(
      encodeFunctionData({
        abi: SEAPORT_ABI,
        functionName: 'fulfillBasicOrder_efficient_6GL6yc',
        args: [basicParams({ basicOrderType: 8 })],
      })
    )!;
    expect(decoded.variant).toBe('fulfill_basic_order_efficient');
    expect(decoded.signature).toBe(
      SEAPORT_SIGNATURES.fulfill_basic_order_efficient
    );
    expect(decoded.basicRoute).toBe('erc20_to_erc721');
    expect(decoded.offer[0]?.itemKind).toBe('erc721');
    expect(decoded.consideration[0]?.itemKind).toBe('erc20');
  });

  it('maps item, order, and basic-route kinds, including unknowns', () => {
    expect(seaportItemKind(0)).toBe('native');
    expect(seaportItemKind(5)).toBe('erc1155_with_criteria');
    expect(seaportItemKind(9)).toBe('unknown');
    expect(seaportOrderKind(2)).toBe('full_restricted');
    expect(seaportOrderKind(99)).toBe('unknown');
    expect(seaportBasicRoute(0)).toBe('eth_to_erc721');
    expect(seaportBasicRoute(20)).toBe('erc1155_to_erc20');
    expect(seaportBasicRoute(24)).toBe('unknown');
    expect(isSeaportNamedRecipient(FEE)).toBe(true);
    expect(isSeaportNamedRecipient(ZERO)).toBe(false);
    expect(isSeaportNamedRecipient(null)).toBe(false);
  });

  it('throws when the selector matches but the payload is truncated', () => {
    expect(() => decodeSeaport('0xb3a34c4c0001')).toThrow(
      /Malformed arguments for fulfillOrder/
    );
  });

  it('throws when there are too many offer items or additional recipients', () => {
    const manyOffer = Array.from({ length: MAX_SEAPORT_ITEMS + 1 }, () => offerNft);
    expect(() => decodeSeaport(fulfillOrder({ offer: manyOffer }))).toThrow(
      /limit is 256/
    );

    const manyFees = Array.from(
      { length: MAX_SEAPORT_ADDITIONAL_RECIPIENTS + 1 },
      () => ({ amount: 1n, recipient: FEE })
    );
    expect(() =>
      decodeSeaport(
        encodeFunctionData({
          abi: SEAPORT_ABI,
          functionName: 'fulfillBasicOrder',
          args: [basicParams({ additionalRecipients: manyFees })],
        })
      )
    ).toThrow(/limit is 256/);
  });
});
