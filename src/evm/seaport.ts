import {
  decodeFunctionData,
  parseAbi,
  toFunctionSelector,
  type AbiFunction,
  type Hex,
} from 'viem';
import { isHexString, isZeroAddress, stripHexPrefix } from './hex';

/** Offer / consideration lists larger than this are rejected. */
export const MAX_SEAPORT_ITEMS = 256;

/** Additional-recipient lists larger than this are rejected. */
export const MAX_SEAPORT_ADDITIONAL_RECIPIENTS = 256;

/** Criteria-resolver lists larger than this are rejected. */
export const MAX_SEAPORT_CRITERIA_RESOLVERS = 256;

/** Risk id when an approval or permit is tucked inside Seaport extraData. */
export const SEAPORT_HIDDEN_GRANT_RISK = 'seaport_hidden_grant';

/** Which Seaport fulfill ABI the calldata used. */
export type SeaportVariant =
  | 'fulfill_order'
  | 'fulfill_advanced_order'
  | 'fulfill_basic_order'
  | 'fulfill_basic_order_efficient';

/**
 * Seaport `ItemType`. Values outside 0–5 stay `unknown` so a newer
 * item type still decodes.
 */
export type SeaportItemKind =
  | 'native'
  | 'erc20'
  | 'erc721'
  | 'erc1155'
  | 'erc721_with_criteria'
  | 'erc1155_with_criteria'
  | 'unknown';

export const SEAPORT_ITEM_KINDS: readonly SeaportItemKind[] = Object.freeze([
  'native',
  'erc20',
  'erc721',
  'erc1155',
  'erc721_with_criteria',
  'erc1155_with_criteria',
]);

/**
 * Seaport `OrderType`. Values outside 0–4 stay `unknown` so a newer
 * order type still decodes.
 */
export type SeaportOrderKind =
  | 'full_open'
  | 'partial_open'
  | 'full_restricted'
  | 'partial_restricted'
  | 'contract'
  | 'unknown';

export const SEAPORT_ORDER_KINDS: readonly SeaportOrderKind[] = Object.freeze([
  'full_open',
  'partial_open',
  'full_restricted',
  'partial_restricted',
  'contract',
]);

/** Which way a `fulfillBasicOrder` listing or offer moves value. */
export type SeaportBasicRoute =
  | 'eth_to_erc721'
  | 'eth_to_erc1155'
  | 'erc20_to_erc721'
  | 'erc20_to_erc1155'
  | 'erc721_to_erc20'
  | 'erc1155_to_erc20'
  | 'unknown';

const BASIC_ROUTES: readonly SeaportBasicRoute[] = Object.freeze([
  'eth_to_erc721',
  'eth_to_erc1155',
  'erc20_to_erc721',
  'erc20_to_erc1155',
  'erc721_to_erc20',
  'erc1155_to_erc20',
]);

/** Offer vs consideration side of a criteria resolver. */
export type SeaportSide = 'offer' | 'consideration' | 'unknown';

export type SeaportOfferItem = {
  index: number;
  itemType: number;
  itemKind: SeaportItemKind;
  token: string;
  identifier: bigint;
  startAmount: bigint;
  endAmount: bigint;
};

export type SeaportConsiderationItem = SeaportOfferItem & {
  recipient: string;
};

export type SeaportAdditionalRecipient = {
  index: number;
  amount: bigint;
  recipient: string;
};

export type SeaportCriteriaResolver = {
  index: number;
  orderIndex: bigint;
  side: SeaportSide;
  itemIndex: bigint;
  identifier: bigint;
  criteriaProof: string[];
};

export type SeaportDecoded = {
  method: 'seaport';
  variant: SeaportVariant;
  signature: string;
  offerer: string;
  zone: string;
  offer: SeaportOfferItem[];
  consideration: SeaportConsiderationItem[];
  orderType: number;
  orderKind: SeaportOrderKind;
  startTime: bigint;
  endTime: bigint;
  zoneHash: string;
  salt: bigint;
  conduitKey: string;
  totalOriginalConsiderationItems: number;
  fulfillerConduitKey: string | null;
  /** Packed order signature bytes, 0x-prefixed lowercase hex. */
  orderSignature: string;
  numerator: bigint | null;
  denominator: bigint | null;
  extraData: string;
  recipient: string | null;
  basicOrderType: number | null;
  basicRoute: SeaportBasicRoute | null;
  additionalRecipients: SeaportAdditionalRecipient[];
  criteriaResolvers: SeaportCriteriaResolver[];
};

const ORDER_PARAMS =
  '(address offerer, address zone, (uint8 itemType, address token, uint256 identifierOrCriteria, uint256 startAmount, uint256 endAmount)[] offer, (uint8 itemType, address token, uint256 identifierOrCriteria, uint256 startAmount, uint256 endAmount, address recipient)[] consideration, uint8 orderType, uint256 startTime, uint256 endTime, bytes32 zoneHash, uint256 salt, bytes32 conduitKey, uint256 totalOriginalConsiderationItems)';

const BASIC_PARAMS =
  '(address considerationToken, uint256 considerationIdentifier, uint256 considerationAmount, address offerer, address zone, address offerToken, uint256 offerIdentifier, uint256 offerAmount, uint8 basicOrderType, uint256 startTime, uint256 endTime, bytes32 zoneHash, uint256 salt, bytes32 offererConduitKey, bytes32 fulfillerConduitKey, uint256 totalOriginalAdditionalRecipients, (uint256 amount, address recipient)[] additionalRecipients, bytes signature)';

const ABI_TEXT: Readonly<Record<SeaportVariant, string>> = Object.freeze({
  fulfill_order: `function fulfillOrder((${ORDER_PARAMS} parameters, bytes signature) order, bytes32 fulfillerConduitKey)`,
  fulfill_advanced_order: `function fulfillAdvancedOrder((${ORDER_PARAMS} parameters, uint120 numerator, uint120 denominator, bytes signature, bytes extraData) advancedOrder, (uint256 orderIndex, uint8 side, uint256 index, uint256 identifier, bytes32[] criteriaProof)[] criteriaResolvers, bytes32 fulfillerConduitKey, address recipient)`,
  fulfill_basic_order: `function fulfillBasicOrder(${BASIC_PARAMS} parameters)`,
  fulfill_basic_order_efficient: `function fulfillBasicOrder_efficient_6GL6yc(${BASIC_PARAMS} parameters)`,
});

/** Canonical ABI signatures, keyed by variant. */
export const SEAPORT_SIGNATURES: Readonly<Record<SeaportVariant, string>> =
  Object.freeze({
    fulfill_order:
      'fulfillOrder(((address,address,(uint8,address,uint256,uint256,uint256)[],(uint8,address,uint256,uint256,uint256,address)[],uint8,uint256,uint256,bytes32,uint256,bytes32,uint256),bytes),bytes32)',
    fulfill_advanced_order:
      'fulfillAdvancedOrder(((address,address,(uint8,address,uint256,uint256,uint256)[],(uint8,address,uint256,uint256,uint256,address)[],uint8,uint256,uint256,bytes32,uint256,bytes32,uint256),uint120,uint120,bytes,bytes),(uint256,uint8,uint256,uint256,bytes32[])[],bytes32,address)',
    fulfill_basic_order:
      'fulfillBasicOrder((address,uint256,uint256,address,address,address,uint256,uint256,uint8,uint256,uint256,bytes32,uint256,bytes32,bytes32,uint256,(uint256,address)[],bytes))',
    fulfill_basic_order_efficient:
      'fulfillBasicOrder_efficient_6GL6yc((address,uint256,uint256,address,address,address,uint256,uint256,uint8,uint256,uint256,bytes32,uint256,bytes32,bytes32,uint256,(uint256,address)[],bytes))',
  });

type CatalogEntry = {
  variant: SeaportVariant;
  item: AbiFunction;
};

function buildCatalog(): Map<string, CatalogEntry> {
  const bySelector = new Map<string, CatalogEntry>();
  for (const variant of Object.keys(ABI_TEXT) as SeaportVariant[]) {
    const item = parseAbi([ABI_TEXT[variant]])[0] as AbiFunction;
    bySelector.set(toFunctionSelector(item), { variant, item });
  }
  return bySelector;
}

const CATALOG = buildCatalog();
const CATALOG_ABI: readonly AbiFunction[] = [...CATALOG.values()].map(
  (entry) => entry.item
);

function asHex(value: string): string {
  const hex = stripHexPrefix(value).toLowerCase();
  return hex.length === 0 ? '0x' : `0x${hex}`;
}

function asAddress(value: string): string {
  return `0x${stripHexPrefix(value).toLowerCase()}`;
}

function asBigint(value: bigint | number): bigint {
  return typeof value === 'bigint' ? value : BigInt(value);
}

function asUint(value: bigint | number, signature: string): number {
  const n = typeof value === 'bigint' ? Number(value) : Number(value);
  if (!Number.isInteger(n) || n < 0 || n > Number.MAX_SAFE_INTEGER) {
    throw new Error(`Malformed arguments for ${signature}`);
  }
  return n;
}

function packedWord(value: string): string {
  return `0x${stripHexPrefix(value).toLowerCase().padStart(64, '0')}`;
}

/** Map a Seaport `ItemType` byte onto a stable kind. */
export function seaportItemKind(itemType: number): SeaportItemKind {
  return SEAPORT_ITEM_KINDS[itemType] ?? 'unknown';
}

/** Map a Seaport `OrderType` byte onto a stable kind. */
export function seaportOrderKind(orderType: number): SeaportOrderKind {
  return SEAPORT_ORDER_KINDS[orderType] ?? 'unknown';
}

/**
 * Map a `BasicOrderType` onto the six listing/offer routes. Unknown
 * values stay `unknown` so a newer type still decodes.
 */
export function seaportBasicRoute(basicOrderType: number): SeaportBasicRoute {
  if (basicOrderType < 0 || basicOrderType > 23) return 'unknown';
  return BASIC_ROUTES[Math.floor(basicOrderType / 4)] ?? 'unknown';
}

/** True when `address` is a named recipient, not the implicit msg.sender / zero. */
export function isSeaportNamedRecipient(
  address: string | null | undefined
): boolean {
  if (!address) return false;
  return !isZeroAddress(address);
}

type RawOfferItem = {
  itemType: bigint | number;
  token: string;
  identifierOrCriteria: bigint | number;
  startAmount: bigint | number;
  endAmount: bigint | number;
};

type RawConsiderationItem = RawOfferItem & { recipient: string };

type RawOrderParameters = {
  offerer: string;
  zone: string;
  offer: readonly RawOfferItem[];
  consideration: readonly RawConsiderationItem[];
  orderType: bigint | number;
  startTime: bigint | number;
  endTime: bigint | number;
  zoneHash: string;
  salt: bigint | number;
  conduitKey: string;
  totalOriginalConsiderationItems: bigint | number;
};

type RawOrder = {
  parameters: RawOrderParameters;
  signature: string;
};

type RawAdvancedOrder = {
  parameters: RawOrderParameters;
  numerator: bigint | number;
  denominator: bigint | number;
  signature: string;
  extraData: string;
};

type RawAdditionalRecipient = {
  amount: bigint | number;
  recipient: string;
};

type RawBasicOrder = {
  considerationToken: string;
  considerationIdentifier: bigint | number;
  considerationAmount: bigint | number;
  offerer: string;
  zone: string;
  offerToken: string;
  offerIdentifier: bigint | number;
  offerAmount: bigint | number;
  basicOrderType: bigint | number;
  startTime: bigint | number;
  endTime: bigint | number;
  zoneHash: string;
  salt: bigint | number;
  offererConduitKey: string;
  fulfillerConduitKey: string;
  totalOriginalAdditionalRecipients: bigint | number;
  additionalRecipients: readonly RawAdditionalRecipient[];
  signature: string;
};

type RawCriteriaResolver = {
  orderIndex: bigint | number;
  side: bigint | number;
  index: bigint | number;
  identifier: bigint | number;
  criteriaProof: readonly string[];
};

function emptyShared(): Pick<
  SeaportDecoded,
  | 'fulfillerConduitKey'
  | 'orderSignature'
  | 'numerator'
  | 'denominator'
  | 'extraData'
  | 'recipient'
  | 'basicOrderType'
  | 'basicRoute'
  | 'additionalRecipients'
  | 'criteriaResolvers'
> {
  return {
    fulfillerConduitKey: null,
    orderSignature: '0x',
    numerator: null,
    denominator: null,
    extraData: '0x',
    recipient: null,
    basicOrderType: null,
    basicRoute: null,
    additionalRecipients: [],
    criteriaResolvers: [],
  };
}

function parseOffer(
  raw: readonly RawOfferItem[],
  signature: string
): SeaportOfferItem[] {
  if (raw.length > MAX_SEAPORT_ITEMS) {
    throw new Error(
      `Order has ${raw.length} offer items; the limit is ${MAX_SEAPORT_ITEMS}`
    );
  }
  return raw.map((item, index) => {
    const itemType = asUint(item.itemType, signature);
    return {
      index,
      itemType,
      itemKind: seaportItemKind(itemType),
      token: asAddress(item.token),
      identifier: asBigint(item.identifierOrCriteria),
      startAmount: asBigint(item.startAmount),
      endAmount: asBigint(item.endAmount),
    };
  });
}

function parseConsideration(
  raw: readonly RawConsiderationItem[],
  signature: string
): SeaportConsiderationItem[] {
  if (raw.length > MAX_SEAPORT_ITEMS) {
    throw new Error(
      `Order has ${raw.length} consideration items; the limit is ${MAX_SEAPORT_ITEMS}`
    );
  }
  return raw.map((item, index) => {
    const itemType = asUint(item.itemType, signature);
    return {
      index,
      itemType,
      itemKind: seaportItemKind(itemType),
      token: asAddress(item.token),
      identifier: asBigint(item.identifierOrCriteria),
      startAmount: asBigint(item.startAmount),
      endAmount: asBigint(item.endAmount),
      recipient: asAddress(item.recipient),
    };
  });
}

function parseAdditionalRecipients(
  raw: readonly RawAdditionalRecipient[],
  signature: string
): SeaportAdditionalRecipient[] {
  if (raw.length > MAX_SEAPORT_ADDITIONAL_RECIPIENTS) {
    throw new Error(
      `Order has ${raw.length} additional recipients; the limit is ${MAX_SEAPORT_ADDITIONAL_RECIPIENTS}`
    );
  }
  return raw.map((item, index) => ({
    index,
    amount: asBigint(item.amount),
    recipient: asAddress(item.recipient),
  }));
}

function parseCriteriaResolvers(
  raw: readonly RawCriteriaResolver[],
  signature: string
): SeaportCriteriaResolver[] {
  if (raw.length > MAX_SEAPORT_CRITERIA_RESOLVERS) {
    throw new Error(
      `Order has ${raw.length} criteria resolvers; the limit is ${MAX_SEAPORT_CRITERIA_RESOLVERS}`
    );
  }
  return raw.map((item, index) => {
    const side = asUint(item.side, signature);
    return {
      index,
      orderIndex: asBigint(item.orderIndex),
      side: side === 0 ? 'offer' : side === 1 ? 'consideration' : 'unknown',
      itemIndex: asBigint(item.index),
      identifier: asBigint(item.identifier),
      criteriaProof: item.criteriaProof.map((word) => packedWord(word)),
    };
  });
}

function fromOrderParameters(
  parameters: RawOrderParameters,
  signature: string
): Pick<
  SeaportDecoded,
  | 'offerer'
  | 'zone'
  | 'offer'
  | 'consideration'
  | 'orderType'
  | 'orderKind'
  | 'startTime'
  | 'endTime'
  | 'zoneHash'
  | 'salt'
  | 'conduitKey'
  | 'totalOriginalConsiderationItems'
> {
  const orderType = asUint(parameters.orderType, signature);
  return {
    offerer: asAddress(parameters.offerer),
    zone: asAddress(parameters.zone),
    offer: parseOffer(parameters.offer, signature),
    consideration: parseConsideration(parameters.consideration, signature),
    orderType,
    orderKind: seaportOrderKind(orderType),
    startTime: asBigint(parameters.startTime),
    endTime: asBigint(parameters.endTime),
    zoneHash: packedWord(parameters.zoneHash),
    salt: asBigint(parameters.salt),
    conduitKey: packedWord(parameters.conduitKey),
    totalOriginalConsiderationItems: asUint(
      parameters.totalOriginalConsiderationItems,
      signature
    ),
  };
}

/**
 * Expand a compact basic order into one offer item and a consideration
 * list (primary item to the offerer, then each additional recipient).
 */
function fromBasicOrder(
  parameters: RawBasicOrder,
  signature: string
): Pick<
  SeaportDecoded,
  | 'offerer'
  | 'zone'
  | 'offer'
  | 'consideration'
  | 'orderType'
  | 'orderKind'
  | 'startTime'
  | 'endTime'
  | 'zoneHash'
  | 'salt'
  | 'conduitKey'
  | 'totalOriginalConsiderationItems'
  | 'fulfillerConduitKey'
  | 'orderSignature'
  | 'basicOrderType'
  | 'basicRoute'
  | 'additionalRecipients'
> {
  const basicOrderType = asUint(parameters.basicOrderType, signature);
  const route = seaportBasicRoute(basicOrderType);
  const orderType = basicOrderType % 4;
  const additionalRecipients = parseAdditionalRecipients(
    parameters.additionalRecipients,
    signature
  );
  const offerKind: SeaportItemKind =
    route === 'eth_to_erc721' || route === 'erc20_to_erc721'
      ? 'erc721'
      : route === 'eth_to_erc1155' || route === 'erc20_to_erc1155'
        ? 'erc1155'
        : route === 'erc721_to_erc20' || route === 'erc1155_to_erc20'
          ? 'erc20'
          : 'unknown';
  const considerationKind: SeaportItemKind =
    route === 'eth_to_erc721' || route === 'eth_to_erc1155'
      ? 'native'
      : route === 'erc20_to_erc721' || route === 'erc20_to_erc1155'
        ? 'erc20'
        : route === 'erc721_to_erc20'
          ? 'erc721'
          : route === 'erc1155_to_erc20'
            ? 'erc1155'
            : 'unknown';
  const offerer = asAddress(parameters.offerer);
  const considerationToken = asAddress(parameters.considerationToken);
  const considerationIdentifier = asBigint(parameters.considerationIdentifier);
  const considerationAmount = asBigint(parameters.considerationAmount);
  const consideration: SeaportConsiderationItem[] = [
    {
      index: 0,
      itemType:
        considerationKind === 'native'
          ? 0
          : considerationKind === 'erc20'
            ? 1
            : considerationKind === 'erc721'
              ? 2
              : considerationKind === 'erc1155'
                ? 3
                : 255,
      itemKind: considerationKind,
      token: considerationToken,
      identifier: considerationIdentifier,
      startAmount: considerationAmount,
      endAmount: considerationAmount,
      recipient: offerer,
    },
    ...additionalRecipients.map((item, index): SeaportConsiderationItem => {
      const extraKind: SeaportItemKind =
        considerationKind === 'native' || considerationKind === 'erc20'
          ? considerationKind
          : 'unknown';
      return {
        index: index + 1,
        itemType:
          extraKind === 'native' ? 0 : extraKind === 'erc20' ? 1 : 255,
        itemKind: extraKind,
        token: considerationToken,
        identifier: 0n,
        startAmount: item.amount,
        endAmount: item.amount,
        recipient: item.recipient,
      };
    }),
  ];
  return {
    offerer,
    zone: asAddress(parameters.zone),
    offer: [
      {
        index: 0,
        itemType:
          offerKind === 'erc20'
            ? 1
            : offerKind === 'erc721'
              ? 2
              : offerKind === 'erc1155'
                ? 3
                : 255,
        itemKind: offerKind,
        token: asAddress(parameters.offerToken),
        identifier: asBigint(parameters.offerIdentifier),
        startAmount: asBigint(parameters.offerAmount),
        endAmount: asBigint(parameters.offerAmount),
      },
    ],
    consideration,
    orderType,
    orderKind: seaportOrderKind(orderType),
    startTime: asBigint(parameters.startTime),
    endTime: asBigint(parameters.endTime),
    zoneHash: packedWord(parameters.zoneHash),
    salt: asBigint(parameters.salt),
    conduitKey: packedWord(parameters.offererConduitKey),
    totalOriginalConsiderationItems: asUint(
      parameters.totalOriginalAdditionalRecipients,
      signature
    ),
    fulfillerConduitKey: packedWord(parameters.fulfillerConduitKey),
    orderSignature: asHex(parameters.signature),
    basicOrderType,
    basicRoute: route,
    additionalRecipients,
  };
}

/**
 * Decode Seaport `fulfillOrder`, `fulfillAdvancedOrder`,
 * `fulfillBasicOrder`, and `fulfillBasicOrder_efficient_6GL6yc`, or
 * null when the selector is not a known Seaport fulfill ABI. Throws
 * when the selector matches but the arguments are malformed or an
 * item / recipient list is too long.
 */
export function decodeSeaport(data: string): SeaportDecoded | null {
  if (!isHexString(data)) {
    throw new Error('Invalid hex data');
  }
  const hex = stripHexPrefix(data).toLowerCase();
  if (hex.length < 8) return null;
  const selector = `0x${hex.slice(0, 8)}`;
  const entry = CATALOG.get(selector);
  if (!entry) return null;

  const signature = SEAPORT_SIGNATURES[entry.variant];
  let args: readonly unknown[];
  try {
    const decoded = decodeFunctionData({
      abi: CATALOG_ABI,
      data: `0x${hex}` as Hex,
    });
    args = (decoded.args ?? []) as readonly unknown[];
  } catch {
    throw new Error(`Malformed arguments for ${signature}`);
  }

  if (entry.variant === 'fulfill_order') {
    const order = args[0] as RawOrder;
    return {
      method: 'seaport',
      variant: entry.variant,
      signature,
      ...emptyShared(),
      ...fromOrderParameters(order.parameters, signature),
      fulfillerConduitKey: packedWord(args[1] as string),
      orderSignature: asHex(order.signature),
    };
  }

  if (entry.variant === 'fulfill_advanced_order') {
    const order = args[0] as RawAdvancedOrder;
    return {
      method: 'seaport',
      variant: entry.variant,
      signature,
      ...emptyShared(),
      ...fromOrderParameters(order.parameters, signature),
      numerator: asBigint(order.numerator),
      denominator: asBigint(order.denominator),
      extraData: asHex(order.extraData),
      orderSignature: asHex(order.signature),
      criteriaResolvers: parseCriteriaResolvers(
        args[1] as readonly RawCriteriaResolver[],
        signature
      ),
      fulfillerConduitKey: packedWord(args[2] as string),
      recipient: asAddress(args[3] as string),
    };
  }

  const parameters = args[0] as RawBasicOrder;
  return {
    method: 'seaport',
    variant: entry.variant,
    signature,
    ...emptyShared(),
    ...fromBasicOrder(parameters, signature),
  };
}
