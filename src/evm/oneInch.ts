import {
  decodeFunctionData,
  parseAbi,
  toFunctionSelector,
  type AbiFunction,
  type Hex,
} from 'viem';
import { isHexString, stripHexPrefix } from './hex';

/**
 * 1inch Aggregation Router V5 `SwapDescription.flags` bit 0: the swap
 * may spend less than `amount` when liquidity is thin.
 */
export const ONEINCH_FLAG_PARTIAL_FILL = 1n << 0n;

/** Bit 1: the caller attached extra ETH that the executor may keep. */
export const ONEINCH_FLAG_REQUIRES_EXTRA_ETH = 1n << 1n;

/**
 * Bit 2: the router should `transferFrom` the source token itself
 * instead of expecting the executor to pull it.
 */
export const ONEINCH_FLAG_SHOULD_CLAIM = 1n << 2n;

/**
 * 1inch sentinel for native ETH in `srcToken` / `dstToken`. Not an ERC-20.
 */
export const ONEINCH_NATIVE_TOKEN =
  '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

/** Unoswap / Clipper pool lists larger than this are rejected. */
export const MAX_ONEINCH_POOLS = 256;

/** Risk id when an approval or permit is tucked inside a 1inch swap. */
export const ONEINCH_HIDDEN_GRANT_RISK = 'oneinch_hidden_grant';

/** Which Aggregation Router V5 ABI the calldata used. */
export type OneInchVariant =
  | 'swap'
  | 'unoswap_to'
  | 'unoswap_to_with_permit'
  | 'clipper_swap_to'
  | 'clipper_swap_to_with_permit';

export type OneInchDecoded = {
  method: 'oneinch';
  variant: OneInchVariant;
  signature: string;
  /** Aggregation executor that receives `executorData`. Null except `swap`. */
  executor: string | null;
  srcToken: string | null;
  dstToken: string | null;
  /** Where the router sends source tokens before the executor runs. */
  srcReceiver: string | null;
  /** Final token/ETH recipient for `swap`. */
  dstReceiver: string | null;
  /** Recipient for unoswap / Clipper. Null on `swap`. */
  recipient: string | null;
  clipperExchange: string | null;
  amount: bigint | null;
  minReturn: bigint | null;
  flags: bigint | null;
  partialFill: boolean | null;
  requiresExtraEth: boolean | null;
  shouldClaim: boolean | null;
  srcIsEth: boolean;
  dstIsEth: boolean;
  /** Packed unoswap pool words, 0x-prefixed 32-byte hex. */
  pools: string[];
  /** Low 160 bits of each packed pool word. */
  poolAddresses: string[];
  /** Clipper fill deadline (unix seconds). Null except Clipper variants. */
  goodUntil: number | null;
  clipperR: string | null;
  clipperVs: string | null;
  /**
   * Attached permit calldata (`swap` / `*WithPermit`). Empty `0x` when the
   * caller did not pass a permit.
   */
  permit: string;
  /** Inner calldata forwarded to `executor`. Empty `0x` except `swap`. */
  executorData: string;
};

const ABI_TEXT: Readonly<Record<OneInchVariant, string>> = Object.freeze({
  swap: 'function swap(address executor, (address srcToken, address dstToken, address srcReceiver, address dstReceiver, uint256 amount, uint256 minReturnAmount, uint256 flags) desc, bytes permit, bytes data)',
  unoswap_to:
    'function unoswapTo(address recipient, address srcToken, uint256 amount, uint256 minReturn, uint256[] pools)',
  unoswap_to_with_permit:
    'function unoswapToWithPermit(address recipient, address srcToken, uint256 amount, uint256 minReturn, uint256[] pools, bytes permit)',
  clipper_swap_to:
    'function clipperSwapTo(address clipperExchange, address recipient, address srcToken, address dstToken, uint256 inputAmount, uint256 outputAmount, uint256 goodUntil, bytes32 r, bytes32 vs)',
  clipper_swap_to_with_permit:
    'function clipperSwapToWithPermit(address clipperExchange, address recipient, address srcToken, address dstToken, uint256 inputAmount, uint256 outputAmount, uint256 goodUntil, bytes32 r, bytes32 vs, bytes permit)',
});

/** Canonical ABI signatures, keyed by variant. */
export const ONEINCH_SIGNATURES: Readonly<Record<OneInchVariant, string>> =
  Object.freeze({
    swap: 'swap(address,(address,address,address,address,uint256,uint256,uint256),bytes,bytes)',
    unoswap_to: 'unoswapTo(address,address,uint256,uint256,uint256[])',
    unoswap_to_with_permit:
      'unoswapToWithPermit(address,address,uint256,uint256,uint256[],bytes)',
    clipper_swap_to:
      'clipperSwapTo(address,address,address,address,uint256,uint256,uint256,bytes32,bytes32)',
    clipper_swap_to_with_permit:
      'clipperSwapToWithPermit(address,address,address,address,uint256,uint256,uint256,bytes32,bytes32,bytes)',
  });

type CatalogEntry = {
  variant: OneInchVariant;
  item: AbiFunction;
};

function buildCatalog(): Map<string, CatalogEntry> {
  const bySelector = new Map<string, CatalogEntry>();
  for (const variant of Object.keys(ABI_TEXT) as OneInchVariant[]) {
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

function packedWord(value: bigint): string {
  return `0x${value.toString(16).padStart(64, '0')}`;
}

/** True when `token` is the 1inch native-ETH sentinel. */
export function isOneInchNativeToken(token: string | null | undefined): boolean {
  if (!token) return false;
  return asAddress(token) === ONEINCH_NATIVE_TOKEN;
}

/** Pool address recovered from the low 160 bits of a packed unoswap word. */
export function extractOneInchPoolAddress(packed: bigint): string {
  const addr = packed & ((1n << 160n) - 1n);
  return `0x${addr.toString(16).padStart(40, '0')}`;
}

/**
 * Unpack Aggregation Router V5 `SwapDescription.flags`. Extra high bits
 * are ignored so a newer router flag does not fail the decode.
 */
export function extractOneInchSwapFlags(flags: bigint): Pick<
  OneInchDecoded,
  'partialFill' | 'requiresExtraEth' | 'shouldClaim'
> {
  return {
    partialFill: (flags & ONEINCH_FLAG_PARTIAL_FILL) !== 0n,
    requiresExtraEth: (flags & ONEINCH_FLAG_REQUIRES_EXTRA_ETH) !== 0n,
    shouldClaim: (flags & ONEINCH_FLAG_SHOULD_CLAIM) !== 0n,
  };
}

type RawSwapDesc = {
  srcToken: string;
  dstToken: string;
  srcReceiver: string;
  dstReceiver: string;
  amount: bigint | number;
  minReturnAmount: bigint | number;
  flags: bigint | number;
};

function emptyShared(): Pick<
  OneInchDecoded,
  | 'executor'
  | 'srcToken'
  | 'dstToken'
  | 'srcReceiver'
  | 'dstReceiver'
  | 'recipient'
  | 'clipperExchange'
  | 'amount'
  | 'minReturn'
  | 'flags'
  | 'partialFill'
  | 'requiresExtraEth'
  | 'shouldClaim'
  | 'srcIsEth'
  | 'dstIsEth'
  | 'pools'
  | 'poolAddresses'
  | 'goodUntil'
  | 'clipperR'
  | 'clipperVs'
  | 'permit'
  | 'executorData'
> {
  return {
    executor: null,
    srcToken: null,
    dstToken: null,
    srcReceiver: null,
    dstReceiver: null,
    recipient: null,
    clipperExchange: null,
    amount: null,
    minReturn: null,
    flags: null,
    partialFill: null,
    requiresExtraEth: null,
    shouldClaim: null,
    srcIsEth: false,
    dstIsEth: false,
    pools: [],
    poolAddresses: [],
    goodUntil: null,
    clipperR: null,
    clipperVs: null,
    permit: '0x',
    executorData: '0x',
  };
}

function parsePools(
  raw: readonly (bigint | number)[],
  signature: string
): { pools: string[]; poolAddresses: string[] } {
  if (raw.length > MAX_ONEINCH_POOLS) {
    throw new Error(
      `Swap has ${raw.length} pools; the limit is ${MAX_ONEINCH_POOLS}`
    );
  }
  const pools: string[] = [];
  const poolAddresses: string[] = [];
  for (const item of raw) {
    const packed = asBigint(item);
    pools.push(packedWord(packed));
    poolAddresses.push(extractOneInchPoolAddress(packed));
  }
  return { pools, poolAddresses };
}

function withTokens(
  srcToken: string | null,
  dstToken: string | null
): Pick<OneInchDecoded, 'srcToken' | 'dstToken' | 'srcIsEth' | 'dstIsEth'> {
  return {
    srcToken,
    dstToken,
    srcIsEth: isOneInchNativeToken(srcToken),
    dstIsEth: isOneInchNativeToken(dstToken),
  };
}

/**
 * Decode 1inch Aggregation Router V5 `swap` / `unoswapTo` / `clipperSwapTo`
 * (and the WithPermit variants), or null when the selector is not a known
 * router ABI. Throws when the selector matches but the arguments are
 * malformed or a pool list is too long.
 */
export function decodeOneInch(data: string): OneInchDecoded | null {
  if (!isHexString(data)) {
    throw new Error('Invalid hex data');
  }
  const hex = stripHexPrefix(data).toLowerCase();
  if (hex.length < 8) return null;
  const selector = `0x${hex.slice(0, 8)}`;
  const entry = CATALOG.get(selector);
  if (!entry) return null;

  const signature = ONEINCH_SIGNATURES[entry.variant];
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

  if (entry.variant === 'swap') {
    const executor = asAddress(args[0] as string);
    const desc = args[1] as RawSwapDesc;
    const flags = asBigint(desc.flags);
    const srcToken = asAddress(desc.srcToken);
    const dstToken = asAddress(desc.dstToken);
    return {
      method: 'oneinch',
      variant: entry.variant,
      signature,
      ...emptyShared(),
      executor,
      ...withTokens(srcToken, dstToken),
      srcReceiver: asAddress(desc.srcReceiver),
      dstReceiver: asAddress(desc.dstReceiver),
      amount: asBigint(desc.amount),
      minReturn: asBigint(desc.minReturnAmount),
      flags,
      ...extractOneInchSwapFlags(flags),
      permit: asHex(args[2] as string),
      executorData: asHex(args[3] as string),
    };
  }

  if (
    entry.variant === 'unoswap_to' ||
    entry.variant === 'unoswap_to_with_permit'
  ) {
    const srcToken = asAddress(args[1] as string);
    const parsedPools = parsePools(
      args[4] as readonly (bigint | number)[],
      signature
    );
    const permit =
      entry.variant === 'unoswap_to_with_permit'
        ? asHex(args[5] as string)
        : '0x';
    return {
      method: 'oneinch',
      variant: entry.variant,
      signature,
      ...emptyShared(),
      ...withTokens(srcToken, null),
      recipient: asAddress(args[0] as string),
      amount: asBigint(args[2] as bigint | number),
      minReturn: asBigint(args[3] as bigint | number),
      ...parsedPools,
      permit,
    };
  }

  const srcToken = asAddress(args[2] as string);
  const dstToken = asAddress(args[3] as string);
  const goodUntil = asUint(args[6] as bigint | number, signature);
  const permit =
    entry.variant === 'clipper_swap_to_with_permit'
      ? asHex(args[9] as string)
      : '0x';
  return {
    method: 'oneinch',
    variant: entry.variant,
    signature,
    ...emptyShared(),
    ...withTokens(srcToken, dstToken),
    clipperExchange: asAddress(args[0] as string),
    recipient: asAddress(args[1] as string),
    amount: asBigint(args[4] as bigint | number),
    minReturn: asBigint(args[5] as bigint | number),
    goodUntil,
    clipperR: asHex(args[7] as string),
    clipperVs: asHex(args[8] as string),
    permit,
  };
}
