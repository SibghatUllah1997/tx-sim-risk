import {
  decodeFunctionData,
  parseAbi,
  toFunctionSelector,
  type AbiFunction,
  type Hex,
} from 'viem';
import { isHexString, isZeroAddress, stripHexPrefix } from './hex';

/** Fills, item lists, and Merkle proofs larger than this are rejected. */
export const MAX_LOOKSRARE_ITEMS = 256;

/** Risk id when an approval or permit is tucked inside additionalParameters. */
export const LOOKSRARE_HIDDEN_GRANT_RISK = 'looksrare_hidden_grant';

/** Official LooksRare Protocol (v2) on Ethereum mainnet. */
export const LOOKSRARE_PROTOCOL_V2 =
  '0x0000000000e655fae4d56241588680f86e3b2377';

/** Which LooksRare V2 fill ABI the calldata used. */
export type LooksRareVariant =
  | 'execute_taker_ask'
  | 'execute_taker_bid'
  | 'execute_multiple_taker_bids';

/**
 * LooksRare `QuoteType`. Values outside 0–1 stay `unknown` so a newer
 * quote type still decodes.
 */
export type LooksRareQuoteKind = 'bid' | 'ask' | 'unknown';

export const LOOKSRARE_QUOTE_KINDS: readonly LooksRareQuoteKind[] =
  Object.freeze(['bid', 'ask']);

/**
 * LooksRare `CollectionType`. Values outside 0–1 stay `unknown` so a
 * newer collection type still decodes.
 */
export type LooksRareCollectionKind = 'erc721' | 'erc1155' | 'unknown';

export const LOOKSRARE_COLLECTION_KINDS: readonly LooksRareCollectionKind[] =
  Object.freeze(['erc721', 'erc1155']);

/**
 * Documented `strategyId` values. Anything else stays `unknown` so a
 * newer strategy still decodes.
 */
export type LooksRareStrategyKind =
  | 'standard'
  | 'collection_offer'
  | 'unknown';

export const LOOKSRARE_STRATEGY_KINDS: readonly LooksRareStrategyKind[] =
  Object.freeze(['standard', 'collection_offer']);

/**
 * LooksRare `MerkleTreeNodePosition`. Values outside 0–1 stay `unknown`.
 */
export type LooksRareMerklePositionKind = 'left' | 'right' | 'unknown';

export const LOOKSRARE_MERKLE_POSITION_KINDS: readonly LooksRareMerklePositionKind[] =
  Object.freeze(['left', 'right']);

export type LooksRareMaker = {
  quoteType: number;
  quoteKind: LooksRareQuoteKind;
  globalNonce: bigint;
  subsetNonce: bigint;
  orderNonce: bigint;
  strategyId: bigint;
  strategyKind: LooksRareStrategyKind;
  collectionType: number;
  collectionKind: LooksRareCollectionKind;
  collection: string;
  currency: string;
  signer: string;
  startTime: bigint;
  endTime: bigint;
  price: bigint;
  itemIds: bigint[];
  amounts: bigint[];
  additionalParameters: string;
};

export type LooksRareTaker = {
  recipient: string;
  additionalParameters: string;
  /** Token id from a collection-offer taker (`strategyId` 1, abi-encoded uint256). */
  itemId: bigint | null;
};

export type LooksRareMerkleNode = {
  value: string;
  position: number;
  positionKind: LooksRareMerklePositionKind;
};

export type LooksRareMerkleTree = {
  root: string;
  proof: LooksRareMerkleNode[];
};

export type LooksRareFill = {
  index: number;
  taker: LooksRareTaker;
  maker: LooksRareMaker;
  makerSignature: string;
  merkleTree: LooksRareMerkleTree;
};

export type LooksRareDecoded = {
  method: 'looksrare';
  variant: LooksRareVariant;
  signature: string;
  fills: LooksRareFill[];
  affiliate: string;
  isAtomic: boolean | null;
};

const TAKER =
  '(address recipient, bytes additionalParameters)';
const MAKER =
  '(uint8 quoteType, uint256 globalNonce, uint256 subsetNonce, uint256 orderNonce, uint256 strategyId, uint8 collectionType, address collection, address currency, address signer, uint256 startTime, uint256 endTime, uint256 price, uint256[] itemIds, uint256[] amounts, bytes additionalParameters)';
const MERKLE =
  '(bytes32 root, (bytes32 value, uint8 position)[] proof)';

const ABI_TEXT: Readonly<Record<LooksRareVariant, string>> = Object.freeze({
  execute_taker_ask: `function executeTakerAsk(${TAKER} takerAsk, ${MAKER} makerBid, bytes makerSignature, ${MERKLE} merkleTree, address affiliate)`,
  execute_taker_bid: `function executeTakerBid(${TAKER} takerBid, ${MAKER} makerAsk, bytes makerSignature, ${MERKLE} merkleTree, address affiliate)`,
  execute_multiple_taker_bids: `function executeMultipleTakerBids(${TAKER}[] takerBids, ${MAKER}[] makerAsks, bytes[] makerSignatures, ${MERKLE}[] merkleTrees, address affiliate, bool isAtomic)`,
});

/** Canonical ABI signatures, keyed by variant. */
export const LOOKSRARE_SIGNATURES: Readonly<Record<LooksRareVariant, string>> =
  Object.freeze({
    execute_taker_ask:
      'executeTakerAsk((address,bytes),(uint8,uint256,uint256,uint256,uint256,uint8,address,address,address,uint256,uint256,uint256,uint256[],uint256[],bytes),bytes,(bytes32,(bytes32,uint8)[]),address)',
    execute_taker_bid:
      'executeTakerBid((address,bytes),(uint8,uint256,uint256,uint256,uint256,uint8,address,address,address,uint256,uint256,uint256,uint256[],uint256[],bytes),bytes,(bytes32,(bytes32,uint8)[]),address)',
    execute_multiple_taker_bids:
      'executeMultipleTakerBids((address,bytes)[],(uint8,uint256,uint256,uint256,uint256,uint8,address,address,address,uint256,uint256,uint256,uint256[],uint256[],bytes)[],bytes[],(bytes32,(bytes32,uint8)[])[],address,bool)',
  });

type CatalogEntry = {
  variant: LooksRareVariant;
  item: AbiFunction;
};

function buildCatalog(): Map<string, CatalogEntry> {
  const bySelector = new Map<string, CatalogEntry>();
  for (const variant of Object.keys(ABI_TEXT) as LooksRareVariant[]) {
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

function asBigintList(
  raw: readonly (bigint | number)[],
  label: string,
  signature: string
): bigint[] {
  if (raw.length > MAX_LOOKSRARE_ITEMS) {
    throw new Error(
      `Order has ${raw.length} ${label}; the limit is ${MAX_LOOKSRARE_ITEMS}`
    );
  }
  return raw.map((item) => asBigint(item));
}

/** Map a LooksRare `QuoteType` byte onto a stable kind. */
export function looksrareQuoteKind(quoteType: number): LooksRareQuoteKind {
  return LOOKSRARE_QUOTE_KINDS[quoteType] ?? 'unknown';
}

/** Map a LooksRare `CollectionType` byte onto a stable kind. */
export function looksrareCollectionKind(
  collectionType: number
): LooksRareCollectionKind {
  return LOOKSRARE_COLLECTION_KINDS[collectionType] ?? 'unknown';
}

/** Map a documented `strategyId` onto a stable kind. */
export function looksrareStrategyKind(
  strategyId: bigint
): LooksRareStrategyKind {
  if (strategyId === 0n) return 'standard';
  if (strategyId === 1n) return 'collection_offer';
  return 'unknown';
}

/** Map a `MerkleTreeNodePosition` byte onto a stable kind. */
export function looksrareMerklePositionKind(
  position: number
): LooksRareMerklePositionKind {
  return LOOKSRARE_MERKLE_POSITION_KINDS[position] ?? 'unknown';
}

/**
 * True when `address` is a named recipient or affiliate, not the
 * implicit msg.sender / zero address used for "none".
 */
export function isLooksRareNamedAddress(
  address: string | null | undefined
): address is string {
  if (!address) return false;
  return !isZeroAddress(address);
}

/**
 * Collection-offer takers encode the sold token id as a single
 * abi-encoded `uint256` in `additionalParameters`. Returns null when
 * the strategy is not a collection offer or the bytes are not that
 * encoding.
 */
export function looksrareCollectionOfferItemId(
  strategyId: bigint,
  additionalParameters: string
): bigint | null {
  if (strategyId !== 1n) return null;
  if (!isHexString(additionalParameters)) return null;
  const hex = stripHexPrefix(additionalParameters);
  if (hex.length !== 64) return null;
  try {
    return BigInt(`0x${hex}`);
  } catch {
    return null;
  }
}

type RawTaker = {
  recipient: string;
  additionalParameters: string;
};

type RawMaker = {
  quoteType: bigint | number;
  globalNonce: bigint | number;
  subsetNonce: bigint | number;
  orderNonce: bigint | number;
  strategyId: bigint | number;
  collectionType: bigint | number;
  collection: string;
  currency: string;
  signer: string;
  startTime: bigint | number;
  endTime: bigint | number;
  price: bigint | number;
  itemIds: readonly (bigint | number)[];
  amounts: readonly (bigint | number)[];
  additionalParameters: string;
};

type RawMerkleNode = {
  value: string;
  position: bigint | number;
};

type RawMerkleTree = {
  root: string;
  proof: readonly RawMerkleNode[];
};

function parseMaker(raw: RawMaker, signature: string): LooksRareMaker {
  const quoteType = asUint(raw.quoteType, signature);
  const collectionType = asUint(raw.collectionType, signature);
  const strategyId = asBigint(raw.strategyId);
  const itemIds = asBigintList(raw.itemIds, 'item ids', signature);
  const amounts = asBigintList(raw.amounts, 'amounts', signature);
  if (itemIds.length !== amounts.length) {
    throw new Error(
      `Order has ${itemIds.length} item ids and ${amounts.length} amounts`
    );
  }
  return {
    quoteType,
    quoteKind: looksrareQuoteKind(quoteType),
    globalNonce: asBigint(raw.globalNonce),
    subsetNonce: asBigint(raw.subsetNonce),
    orderNonce: asBigint(raw.orderNonce),
    strategyId,
    strategyKind: looksrareStrategyKind(strategyId),
    collectionType,
    collectionKind: looksrareCollectionKind(collectionType),
    collection: asAddress(raw.collection),
    currency: asAddress(raw.currency),
    signer: asAddress(raw.signer),
    startTime: asBigint(raw.startTime),
    endTime: asBigint(raw.endTime),
    price: asBigint(raw.price),
    itemIds,
    amounts,
    additionalParameters: asHex(raw.additionalParameters),
  };
}

function parseTaker(raw: RawTaker, strategyId: bigint): LooksRareTaker {
  const additionalParameters = asHex(raw.additionalParameters);
  return {
    recipient: asAddress(raw.recipient),
    additionalParameters,
    itemId: looksrareCollectionOfferItemId(strategyId, additionalParameters),
  };
}

function parseMerkleTree(
  raw: RawMerkleTree,
  signature: string
): LooksRareMerkleTree {
  if (raw.proof.length > MAX_LOOKSRARE_ITEMS) {
    throw new Error(
      `Order has ${raw.proof.length} Merkle proof nodes; the limit is ${MAX_LOOKSRARE_ITEMS}`
    );
  }
  return {
    root: packedWord(raw.root),
    proof: raw.proof.map((node) => {
      const position = asUint(node.position, signature);
      return {
        value: packedWord(node.value),
        position,
        positionKind: looksrareMerklePositionKind(position),
      };
    }),
  };
}

function parseFill(
  index: number,
  taker: RawTaker,
  maker: RawMaker,
  makerSignature: string,
  merkleTree: RawMerkleTree,
  signature: string
): LooksRareFill {
  const parsedMaker = parseMaker(maker, signature);
  return {
    index,
    taker: parseTaker(taker, parsedMaker.strategyId),
    maker: parsedMaker,
    makerSignature: asHex(makerSignature),
    merkleTree: parseMerkleTree(merkleTree, signature),
  };
}

/**
 * Decode LooksRare V2 `executeTakerAsk`, `executeTakerBid`, and
 * `executeMultipleTakerBids`, or null when the selector is not a known
 * LooksRare fill ABI. Throws when the selector matches but the
 * arguments are malformed or a list is too long.
 */
export function decodeLooksRare(data: string): LooksRareDecoded | null {
  if (!isHexString(data)) {
    throw new Error('Invalid hex data');
  }
  const hex = stripHexPrefix(data).toLowerCase();
  if (hex.length < 8) return null;
  const selector = `0x${hex.slice(0, 8)}`;
  const entry = CATALOG.get(selector);
  if (!entry) return null;

  const signature = LOOKSRARE_SIGNATURES[entry.variant];
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

  if (entry.variant === 'execute_multiple_taker_bids') {
    const takers = args[0] as readonly RawTaker[];
    const makers = args[1] as readonly RawMaker[];
    const signatures = args[2] as readonly string[];
    const trees = args[3] as readonly RawMerkleTree[];
    if (
      takers.length !== makers.length ||
      takers.length !== signatures.length ||
      takers.length !== trees.length
    ) {
      throw new Error(`Malformed arguments for ${signature}`);
    }
    if (takers.length > MAX_LOOKSRARE_ITEMS) {
      throw new Error(
        `Order has ${takers.length} fills; the limit is ${MAX_LOOKSRARE_ITEMS}`
      );
    }
    return {
      method: 'looksrare',
      variant: entry.variant,
      signature,
      fills: takers.map((taker, index) =>
        parseFill(
          index,
          taker,
          makers[index]!,
          signatures[index]!,
          trees[index]!,
          signature
        )
      ),
      affiliate: asAddress(args[4] as string),
      isAtomic: Boolean(args[5]),
    };
  }

  return {
    method: 'looksrare',
    variant: entry.variant,
    signature,
    fills: [
      parseFill(
        0,
        args[0] as RawTaker,
        args[1] as RawMaker,
        args[2] as string,
        args[3] as RawMerkleTree,
        signature
      ),
    ],
    affiliate: asAddress(args[4] as string),
    isAtomic: null,
  };
}
