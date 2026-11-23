import {
  decodeFunctionData,
  parseAbi,
  toFunctionSelector,
  type AbiFunction,
  type Hex,
} from 'viem';
import { isHexString, stripHexPrefix } from './hex';

/** Trades above this are rejected rather than analyzed partially. */
export const MAX_COWSWAP_TRADES = 256;

/** Interactions (all three stages combined) above this are rejected. */
export const MAX_COWSWAP_INTERACTIONS = 256;

/** Risk id when an approval or operator grant is tucked inside a settle interaction. */
export const COWSWAP_HIDDEN_GRANT_RISK = 'cowswap_hidden_grant';

/** Which GPv2Settlement ABI the calldata used. */
export type CowswapVariant = 'settle' | 'set_presignature' | 'invalidate_order';

/** GPv2 order kind recovered from trade flags. */
export type CowswapOrderKind = 'sell' | 'buy';

/** GPv2 token-balance source recovered from trade flags. */
export type CowswapBalanceKind = 'erc20' | 'external' | 'internal';

/** GPv2 signing scheme recovered from trade flags. */
export type CowswapSigningScheme = 'eip712' | 'ethsign' | 'eip1271' | 'presign';

/**
 * Settlement runs interactions in three stages: before tokens in, between
 * in and out, and after tokens out.
 */
export type CowswapInteractionStage = 'pre' | 'intra' | 'post';

export const COWSWAP_INTERACTION_STAGES: readonly CowswapInteractionStage[] =
  Object.freeze(['pre', 'intra', 'post']);

export type CowswapTrade = {
  index: number;
  sellTokenIndex: number;
  buyTokenIndex: number;
  receiver: string;
  sellAmount: bigint;
  buyAmount: bigint;
  validTo: number;
  appData: string;
  feeAmount: bigint;
  flags: bigint;
  executedAmount: bigint;
  signature: string;
  kind: CowswapOrderKind;
  partiallyFillable: boolean;
  sellTokenBalance: CowswapBalanceKind;
  buyTokenBalance: CowswapBalanceKind;
  signingScheme: CowswapSigningScheme;
  /** True when receiver is the zero address (filled as the order owner). */
  receiverIsOwner: boolean;
};

export type CowswapInteraction = {
  index: number;
  stage: CowswapInteractionStage;
  stageIndex: number;
  target: string;
  value: bigint;
  /** Inner calldata, 0x-prefixed lowercase hex. Empty `0x` is a value transfer. */
  data: string;
};

export type CowswapDecoded = {
  method: 'cowswap';
  variant: CowswapVariant;
  signature: string;
  tokens: string[];
  clearingPrices: bigint[];
  trades: CowswapTrade[];
  interactions: CowswapInteraction[];
  /** Order UID for pre-signature / invalidate. Null on settle. */
  orderUid: string | null;
  /** Pre-signature polarity. Null unless `setPreSignature`. */
  signed: boolean | null;
};

const ABI_TEXT: Readonly<Record<CowswapVariant, string>> = Object.freeze({
  settle:
    'function settle(address[] tokens, uint256[] clearingPrices, (uint256 sellTokenIndex, uint256 buyTokenIndex, address receiver, uint256 sellAmount, uint256 buyAmount, uint32 validTo, bytes32 appData, uint256 feeAmount, uint256 flags, uint256 executedAmount, bytes signature)[] trades, (address target, uint256 value, bytes callData)[][3] interactions)',
  set_presignature: 'function setPreSignature(bytes orderUid, bool signed)',
  invalidate_order: 'function invalidateOrder(bytes orderUid)',
});

/** Canonical ABI signatures, keyed by variant. */
export const COWSWAP_SIGNATURES: Readonly<Record<CowswapVariant, string>> =
  Object.freeze({
    settle:
      'settle(address[],uint256[],(uint256,uint256,address,uint256,uint256,uint32,bytes32,uint256,uint256,uint256,bytes)[],(address,uint256,bytes)[][3])',
    set_presignature: 'setPreSignature(bytes,bool)',
    invalidate_order: 'invalidateOrder(bytes)',
  });

const SIGNING_SCHEMES: readonly CowswapSigningScheme[] = [
  'eip712',
  'ethsign',
  'eip1271',
  'presign',
];

type CatalogEntry = {
  variant: CowswapVariant;
  item: AbiFunction;
  selector: string;
};

function buildCatalog(): Map<string, CatalogEntry> {
  const bySelector = new Map<string, CatalogEntry>();
  for (const variant of Object.keys(ABI_TEXT) as CowswapVariant[]) {
    const item = parseAbi([ABI_TEXT[variant]])[0] as AbiFunction;
    bySelector.set(toFunctionSelector(item), {
      variant,
      item,
      selector: toFunctionSelector(item),
    });
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

/** True when `receiver` is the GPv2 "fill to owner" sentinel. */
export function isCowswapOwnerReceiver(receiver: string): boolean {
  return asAddress(receiver) === '0x0000000000000000000000000000000000000000';
}

function parseBalanceKind(
  flag: number,
  allowExternal: boolean,
  signature: string
): CowswapBalanceKind {
  if (flag === 0) return 'erc20';
  if (flag === 1 && allowExternal) return 'external';
  if (flag === 2) return 'internal';
  throw new Error(`Malformed arguments for ${signature}`);
}

/**
 * Unpack GPv2 trade flags: kind, fill mode, sell/buy balance, signing scheme.
 * Buy-side external balance is invalid on-chain and rejected here too.
 */
export function extractCowswapFlags(
  flags: bigint,
  signature: string = COWSWAP_SIGNATURES.settle
): Pick<
  CowswapTrade,
  | 'kind'
  | 'partiallyFillable'
  | 'sellTokenBalance'
  | 'buyTokenBalance'
  | 'signingScheme'
> {
  const kind: CowswapOrderKind = (flags & 1n) === 0n ? 'sell' : 'buy';
  const partiallyFillable = (flags & 2n) !== 0n;
  const sellTokenBalance = parseBalanceKind(
    Number((flags >> 2n) & 3n),
    true,
    signature
  );
  const buyTokenBalance = parseBalanceKind(
    Number((flags >> 4n) & 3n),
    false,
    signature
  );
  const signingScheme = SIGNING_SCHEMES[Number((flags >> 6n) & 3n)];
  if (!signingScheme) {
    throw new Error(`Malformed arguments for ${signature}`);
  }
  return {
    kind,
    partiallyFillable,
    sellTokenBalance,
    buyTokenBalance,
    signingScheme,
  };
}

type RawTrade = {
  sellTokenIndex: bigint | number;
  buyTokenIndex: bigint | number;
  receiver: string;
  sellAmount: bigint | number;
  buyAmount: bigint | number;
  validTo: bigint | number;
  appData: string;
  feeAmount: bigint | number;
  flags: bigint | number;
  executedAmount: bigint | number;
  signature: string;
};

type RawInteraction = {
  target: string;
  value: bigint | number;
  callData: string;
};

function parseTrade(
  raw: RawTrade,
  index: number,
  tokenCount: number,
  signature: string
): CowswapTrade {
  const sellTokenIndex = asUint(raw.sellTokenIndex, signature);
  const buyTokenIndex = asUint(raw.buyTokenIndex, signature);
  if (sellTokenIndex >= tokenCount || buyTokenIndex >= tokenCount) {
    throw new Error(`Malformed arguments for ${signature}`);
  }
  const receiver = asAddress(raw.receiver);
  const flags = asBigint(raw.flags);
  const unpacked = extractCowswapFlags(flags, signature);
  const validTo = asUint(raw.validTo, signature);
  if (validTo > 0xffffffff) {
    throw new Error(`Malformed arguments for ${signature}`);
  }
  return {
    index,
    sellTokenIndex,
    buyTokenIndex,
    receiver,
    sellAmount: asBigint(raw.sellAmount),
    buyAmount: asBigint(raw.buyAmount),
    validTo,
    appData: asHex(raw.appData),
    feeAmount: asBigint(raw.feeAmount),
    flags,
    executedAmount: asBigint(raw.executedAmount),
    signature: asHex(raw.signature),
    receiverIsOwner: isCowswapOwnerReceiver(receiver),
    ...unpacked,
  };
}

function parseInteractions(
  stages: readonly RawInteraction[][],
  signature: string
): CowswapInteraction[] {
  if (stages.length !== 3) {
    throw new Error(`Malformed arguments for ${signature}`);
  }
  const interactions: CowswapInteraction[] = [];
  stages.forEach((stageCalls, stagePos) => {
    const stage = COWSWAP_INTERACTION_STAGES[stagePos];
    if (!stage) {
      throw new Error(`Malformed arguments for ${signature}`);
    }
    stageCalls.forEach((call, stageIndex) => {
      interactions.push({
        index: interactions.length,
        stage,
        stageIndex,
        target: asAddress(call.target),
        value: asBigint(call.value),
        data: asHex(call.callData),
      });
    });
  });
  if (interactions.length > MAX_COWSWAP_INTERACTIONS) {
    throw new Error(
      `Settlement has ${interactions.length} interactions; the limit is ${MAX_COWSWAP_INTERACTIONS}`
    );
  }
  return interactions;
}

function emptySettleFields(): Pick<
  CowswapDecoded,
  'tokens' | 'clearingPrices' | 'trades' | 'interactions'
> {
  return {
    tokens: [],
    clearingPrices: [],
    trades: [],
    interactions: [],
  };
}

/**
 * Decode Cow Protocol GPv2Settlement `settle` / `setPreSignature` /
 * `invalidateOrder` calldata, or null when the selector is not a known
 * settlement ABI. Throws when the selector matches but the arguments are
 * malformed, token indices are out of range, or a trade flag is invalid.
 */
export function decodeCowswap(data: string): CowswapDecoded | null {
  if (!isHexString(data)) {
    throw new Error('Invalid hex data');
  }
  const hex = stripHexPrefix(data).toLowerCase();
  if (hex.length < 8) return null;
  const selector = `0x${hex.slice(0, 8)}`;
  const entry = CATALOG.get(selector);
  if (!entry) return null;

  const signature = COWSWAP_SIGNATURES[entry.variant];
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

  if (entry.variant === 'set_presignature') {
    return {
      method: 'cowswap',
      variant: entry.variant,
      signature,
      ...emptySettleFields(),
      orderUid: asHex(args[0] as string),
      signed: Boolean(args[1]),
    };
  }

  if (entry.variant === 'invalidate_order') {
    return {
      method: 'cowswap',
      variant: entry.variant,
      signature,
      ...emptySettleFields(),
      orderUid: asHex(args[0] as string),
      signed: null,
    };
  }

  const tokens = (args[0] as readonly string[]).map(asAddress);
  const clearingPrices = (args[1] as readonly (bigint | number)[]).map(asBigint);
  if (tokens.length !== clearingPrices.length) {
    throw new Error(`Malformed arguments for ${signature}`);
  }
  const rawTrades = args[2] as readonly RawTrade[];
  if (rawTrades.length > MAX_COWSWAP_TRADES) {
    throw new Error(
      `Settlement has ${rawTrades.length} trades; the limit is ${MAX_COWSWAP_TRADES}`
    );
  }
  const trades = rawTrades.map((trade, index) =>
    parseTrade(trade, index, tokens.length, signature)
  );
  const interactions = parseInteractions(
    args[3] as readonly RawInteraction[][],
    signature
  );

  return {
    method: 'cowswap',
    variant: entry.variant,
    signature,
    tokens,
    clearingPrices,
    trades,
    interactions,
    orderUid: null,
    signed: null,
  };
}
