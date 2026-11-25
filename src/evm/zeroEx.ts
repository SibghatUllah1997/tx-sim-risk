import {
  decodeFunctionData,
  parseAbi,
  toFunctionSelector,
  type AbiFunction,
  type Hex,
} from 'viem';
import { isHexString, stripHexPrefix } from './hex';

/**
 * 0x Exchange Proxy sentinel for native ETH in `inputToken` / `outputToken`
 * and order token fields. Not an ERC-20.
 */
export const ZEROEX_NATIVE_TOKEN =
  '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

/** Transformation lists larger than this are rejected. */
export const MAX_ZEROEX_TRANSFORMATIONS = 256;

/** Meta-transaction V2 fee lists larger than this are rejected. */
export const MAX_ZEROEX_FEES = 256;

/** Risk id when an approval or permit is tucked inside a 0x envelope. */
export const ZEROEX_HIDDEN_GRANT_RISK = 'zeroex_hidden_grant';

/** Which Exchange Proxy ABI the calldata used. */
export type ZeroExVariant =
  | 'transform_erc20'
  | 'execute_meta_transaction'
  | 'execute_meta_transaction_v2'
  | 'fill_limit_order'
  | 'fill_rfq_order'
  | 'fill_otc_order';

/**
 * LibSignature.SignatureType recovered from the packed signature struct.
 * Values outside 0–4 stay `unknown` so a newer type does not fail the decode.
 */
export type ZeroExSignatureKind =
  | 'illegal'
  | 'invalid'
  | 'eip712'
  | 'ethsign'
  | 'presigned'
  | 'unknown';

export const ZEROEX_SIGNATURE_KINDS: readonly ZeroExSignatureKind[] =
  Object.freeze([
    'illegal',
    'invalid',
    'eip712',
    'ethsign',
    'presigned',
  ]);

/** One `transformERC20` transformer step. */
export type ZeroExTransformation = {
  index: number;
  deploymentNonce: number;
  /** Inner transformer calldata, 0x-prefixed lowercase hex. */
  data: string;
};

/** One ERC-20 fee the meta-tx signer pays on V2. */
export type ZeroExFee = {
  index: number;
  recipient: string;
  amount: bigint;
};

export type ZeroExDecoded = {
  method: 'zeroex';
  variant: ZeroExVariant;
  signature: string;
  inputToken: string | null;
  outputToken: string | null;
  inputTokenAmount: bigint | null;
  minOutputTokenAmount: bigint | null;
  inputIsEth: boolean;
  outputIsEth: boolean;
  transformations: ZeroExTransformation[];
  signer: string | null;
  sender: string | null;
  minGasPrice: bigint | null;
  maxGasPrice: bigint | null;
  expirationTimeSeconds: number | null;
  salt: bigint | null;
  /** Inner Exchange Proxy calldata. Empty `0x` except meta-transaction variants. */
  callData: string;
  value: bigint | null;
  feeToken: string | null;
  feeAmount: bigint | null;
  fees: ZeroExFee[];
  makerToken: string | null;
  takerToken: string | null;
  makerAmount: bigint | null;
  takerAmount: bigint | null;
  takerTokenFeeAmount: bigint | null;
  maker: string | null;
  taker: string | null;
  txOrigin: string | null;
  feeRecipient: string | null;
  pool: string | null;
  expiry: number | null;
  expiryAndNonce: bigint | null;
  takerTokenFillAmount: bigint | null;
  signatureType: number | null;
  signatureKind: ZeroExSignatureKind | null;
  signatureV: number | null;
  signatureR: string | null;
  signatureS: string | null;
};

const ABI_TEXT: Readonly<Record<ZeroExVariant, string>> = Object.freeze({
  transform_erc20:
    'function transformERC20(address inputToken, address outputToken, uint256 inputTokenAmount, uint256 minOutputTokenAmount, (uint32 deploymentNonce, bytes data)[] transformations)',
  execute_meta_transaction:
    'function executeMetaTransaction((address signer, address sender, uint256 minGasPrice, uint256 maxGasPrice, uint256 expirationTimeSeconds, uint256 salt, bytes callData, uint256 value, address feeToken, uint256 feeAmount) mtx, (uint8 signatureType, uint8 v, bytes32 r, bytes32 s) signature)',
  execute_meta_transaction_v2:
    'function executeMetaTransactionV2((address signer, address sender, uint256 expirationTimeSeconds, uint256 salt, bytes callData, address feeToken, (address recipient, uint256 amount)[] fees) mtx, (uint8 signatureType, uint8 v, bytes32 r, bytes32 s) signature)',
  fill_limit_order:
    'function fillLimitOrder((address makerToken, address takerToken, uint128 makerAmount, uint128 takerAmount, uint128 takerTokenFeeAmount, address maker, address taker, address sender, address feeRecipient, bytes32 pool, uint64 expiry, uint256 salt) order, (uint8 signatureType, uint8 v, bytes32 r, bytes32 s) signature, uint128 takerTokenFillAmount)',
  fill_rfq_order:
    'function fillRfqOrder((address makerToken, address takerToken, uint128 makerAmount, uint128 takerAmount, address maker, address taker, address txOrigin, bytes32 pool, uint64 expiry, uint256 salt) order, (uint8 signatureType, uint8 v, bytes32 r, bytes32 s) signature, uint128 takerTokenFillAmount)',
  fill_otc_order:
    'function fillOtcOrder((address makerToken, address takerToken, uint128 makerAmount, uint128 takerAmount, address maker, address taker, address txOrigin, uint256 expiryAndNonce) order, (uint8 signatureType, uint8 v, bytes32 r, bytes32 s) signature, uint128 takerTokenFillAmount)',
});

/** Canonical ABI signatures, keyed by variant. */
export const ZEROEX_SIGNATURES: Readonly<Record<ZeroExVariant, string>> =
  Object.freeze({
    transform_erc20:
      'transformERC20(address,address,uint256,uint256,(uint32,bytes)[])',
    execute_meta_transaction:
      'executeMetaTransaction((address,address,uint256,uint256,uint256,uint256,bytes,uint256,address,uint256),(uint8,uint8,bytes32,bytes32))',
    execute_meta_transaction_v2:
      'executeMetaTransactionV2((address,address,uint256,uint256,bytes,address,(address,uint256)[]),(uint8,uint8,bytes32,bytes32))',
    fill_limit_order:
      'fillLimitOrder((address,address,uint128,uint128,uint128,address,address,address,address,bytes32,uint64,uint256),(uint8,uint8,bytes32,bytes32),uint128)',
    fill_rfq_order:
      'fillRfqOrder((address,address,uint128,uint128,address,address,address,bytes32,uint64,uint256),(uint8,uint8,bytes32,bytes32),uint128)',
    fill_otc_order:
      'fillOtcOrder((address,address,uint128,uint128,address,address,address,uint256),(uint8,uint8,bytes32,bytes32),uint128)',
  });

type CatalogEntry = {
  variant: ZeroExVariant;
  item: AbiFunction;
};

function buildCatalog(): Map<string, CatalogEntry> {
  const bySelector = new Map<string, CatalogEntry>();
  for (const variant of Object.keys(ABI_TEXT) as ZeroExVariant[]) {
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

/** True when `token` is the 0x native-ETH sentinel. */
export function isZeroExNativeToken(token: string | null | undefined): boolean {
  if (!token) return false;
  return asAddress(token) === ZEROEX_NATIVE_TOKEN;
}

/**
 * Map a LibSignature `signatureType` byte onto a stable kind. Unknown
 * values stay `unknown` so a newer proxy type still decodes.
 */
export function zeroExSignatureKind(signatureType: number): ZeroExSignatureKind {
  return ZEROEX_SIGNATURE_KINDS[signatureType] ?? 'unknown';
}

/**
 * Unpack the high 64 bits of an OTC `expiryAndNonce` word. Those bits
 * are the unix-second expiry; the rest is nonce bucket + nonce.
 */
export function extractZeroExOtcExpiry(expiryAndNonce: bigint): number {
  const expiry = expiryAndNonce >> 192n;
  if (expiry > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Malformed arguments for fillOtcOrder');
  }
  return Number(expiry);
}

type RawTransformation = {
  deploymentNonce: bigint | number;
  data: string;
};

type RawFee = {
  recipient: string;
  amount: bigint | number;
};

type RawSignature = {
  signatureType: bigint | number;
  v: bigint | number;
  r: string;
  s: string;
};

type RawMetaTx = {
  signer: string;
  sender: string;
  minGasPrice: bigint | number;
  maxGasPrice: bigint | number;
  expirationTimeSeconds: bigint | number;
  salt: bigint | number;
  callData: string;
  value: bigint | number;
  feeToken: string;
  feeAmount: bigint | number;
};

type RawMetaTxV2 = {
  signer: string;
  sender: string;
  expirationTimeSeconds: bigint | number;
  salt: bigint | number;
  callData: string;
  feeToken: string;
  fees: readonly RawFee[];
};

type RawLimitOrder = {
  makerToken: string;
  takerToken: string;
  makerAmount: bigint | number;
  takerAmount: bigint | number;
  takerTokenFeeAmount: bigint | number;
  maker: string;
  taker: string;
  sender: string;
  feeRecipient: string;
  pool: string;
  expiry: bigint | number;
  salt: bigint | number;
};

type RawRfqOrder = {
  makerToken: string;
  takerToken: string;
  makerAmount: bigint | number;
  takerAmount: bigint | number;
  maker: string;
  taker: string;
  txOrigin: string;
  pool: string;
  expiry: bigint | number;
  salt: bigint | number;
};

type RawOtcOrder = {
  makerToken: string;
  takerToken: string;
  makerAmount: bigint | number;
  takerAmount: bigint | number;
  maker: string;
  taker: string;
  txOrigin: string;
  expiryAndNonce: bigint | number;
};

function emptyShared(): Pick<
  ZeroExDecoded,
  | 'inputToken'
  | 'outputToken'
  | 'inputTokenAmount'
  | 'minOutputTokenAmount'
  | 'inputIsEth'
  | 'outputIsEth'
  | 'transformations'
  | 'signer'
  | 'sender'
  | 'minGasPrice'
  | 'maxGasPrice'
  | 'expirationTimeSeconds'
  | 'salt'
  | 'callData'
  | 'value'
  | 'feeToken'
  | 'feeAmount'
  | 'fees'
  | 'makerToken'
  | 'takerToken'
  | 'makerAmount'
  | 'takerAmount'
  | 'takerTokenFeeAmount'
  | 'maker'
  | 'taker'
  | 'txOrigin'
  | 'feeRecipient'
  | 'pool'
  | 'expiry'
  | 'expiryAndNonce'
  | 'takerTokenFillAmount'
  | 'signatureType'
  | 'signatureKind'
  | 'signatureV'
  | 'signatureR'
  | 'signatureS'
> {
  return {
    inputToken: null,
    outputToken: null,
    inputTokenAmount: null,
    minOutputTokenAmount: null,
    inputIsEth: false,
    outputIsEth: false,
    transformations: [],
    signer: null,
    sender: null,
    minGasPrice: null,
    maxGasPrice: null,
    expirationTimeSeconds: null,
    salt: null,
    callData: '0x',
    value: null,
    feeToken: null,
    feeAmount: null,
    fees: [],
    makerToken: null,
    takerToken: null,
    makerAmount: null,
    takerAmount: null,
    takerTokenFeeAmount: null,
    maker: null,
    taker: null,
    txOrigin: null,
    feeRecipient: null,
    pool: null,
    expiry: null,
    expiryAndNonce: null,
    takerTokenFillAmount: null,
    signatureType: null,
    signatureKind: null,
    signatureV: null,
    signatureR: null,
    signatureS: null,
  };
}

function withTokens(
  inputToken: string | null,
  outputToken: string | null
): Pick<
  ZeroExDecoded,
  'inputToken' | 'outputToken' | 'inputIsEth' | 'outputIsEth'
> {
  return {
    inputToken,
    outputToken,
    inputIsEth: isZeroExNativeToken(inputToken),
    outputIsEth: isZeroExNativeToken(outputToken),
  };
}

function parseTransformations(
  raw: readonly RawTransformation[],
  signature: string
): ZeroExTransformation[] {
  if (raw.length > MAX_ZEROEX_TRANSFORMATIONS) {
    throw new Error(
      `Swap has ${raw.length} transformations; the limit is ${MAX_ZEROEX_TRANSFORMATIONS}`
    );
  }
  return raw.map((item, index) => ({
    index,
    deploymentNonce: asUint(item.deploymentNonce, signature),
    data: asHex(item.data),
  }));
}

function parseFees(
  raw: readonly RawFee[],
  signature: string
): ZeroExFee[] {
  if (raw.length > MAX_ZEROEX_FEES) {
    throw new Error(
      `Meta-transaction has ${raw.length} fees; the limit is ${MAX_ZEROEX_FEES}`
    );
  }
  return raw.map((item, index) => ({
    index,
    recipient: asAddress(item.recipient),
    amount: asBigint(item.amount),
  }));
}

function parseSignature(raw: RawSignature, signature: string) {
  const signatureType = asUint(raw.signatureType, signature);
  return {
    signatureType,
    signatureKind: zeroExSignatureKind(signatureType),
    signatureV: asUint(raw.v, signature),
    signatureR: packedWord(raw.r),
    signatureS: packedWord(raw.s),
  };
}

/**
 * Decode 0x Exchange Proxy `transformERC20`, `executeMetaTransaction` /
 * `executeMetaTransactionV2`, and native `fillLimitOrder` / `fillRfqOrder`
 * / `fillOtcOrder`, or null when the selector is not a known proxy ABI.
 * Throws when the selector matches but the arguments are malformed or a
 * transformation / fee list is too long.
 */
export function decodeZeroEx(data: string): ZeroExDecoded | null {
  if (!isHexString(data)) {
    throw new Error('Invalid hex data');
  }
  const hex = stripHexPrefix(data).toLowerCase();
  if (hex.length < 8) return null;
  const selector = `0x${hex.slice(0, 8)}`;
  const entry = CATALOG.get(selector);
  if (!entry) return null;

  const signature = ZEROEX_SIGNATURES[entry.variant];
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

  if (entry.variant === 'transform_erc20') {
    const inputToken = asAddress(args[0] as string);
    const outputToken = asAddress(args[1] as string);
    return {
      method: 'zeroex',
      variant: entry.variant,
      signature,
      ...emptyShared(),
      ...withTokens(inputToken, outputToken),
      inputTokenAmount: asBigint(args[2] as bigint | number),
      minOutputTokenAmount: asBigint(args[3] as bigint | number),
      transformations: parseTransformations(
        args[4] as readonly RawTransformation[],
        signature
      ),
    };
  }

  if (entry.variant === 'execute_meta_transaction') {
    const mtx = args[0] as RawMetaTx;
    return {
      method: 'zeroex',
      variant: entry.variant,
      signature,
      ...emptyShared(),
      signer: asAddress(mtx.signer),
      sender: asAddress(mtx.sender),
      minGasPrice: asBigint(mtx.minGasPrice),
      maxGasPrice: asBigint(mtx.maxGasPrice),
      expirationTimeSeconds: asUint(mtx.expirationTimeSeconds, signature),
      salt: asBigint(mtx.salt),
      callData: asHex(mtx.callData),
      value: asBigint(mtx.value),
      feeToken: asAddress(mtx.feeToken),
      feeAmount: asBigint(mtx.feeAmount),
      ...parseSignature(args[1] as RawSignature, signature),
    };
  }

  if (entry.variant === 'execute_meta_transaction_v2') {
    const mtx = args[0] as RawMetaTxV2;
    return {
      method: 'zeroex',
      variant: entry.variant,
      signature,
      ...emptyShared(),
      signer: asAddress(mtx.signer),
      sender: asAddress(mtx.sender),
      expirationTimeSeconds: asUint(mtx.expirationTimeSeconds, signature),
      salt: asBigint(mtx.salt),
      callData: asHex(mtx.callData),
      feeToken: asAddress(mtx.feeToken),
      fees: parseFees(mtx.fees, signature),
      ...parseSignature(args[1] as RawSignature, signature),
    };
  }

  if (entry.variant === 'fill_limit_order') {
    const order = args[0] as RawLimitOrder;
    return {
      method: 'zeroex',
      variant: entry.variant,
      signature,
      ...emptyShared(),
      ...withTokens(asAddress(order.takerToken), asAddress(order.makerToken)),
      makerToken: asAddress(order.makerToken),
      takerToken: asAddress(order.takerToken),
      makerAmount: asBigint(order.makerAmount),
      takerAmount: asBigint(order.takerAmount),
      takerTokenFeeAmount: asBigint(order.takerTokenFeeAmount),
      maker: asAddress(order.maker),
      taker: asAddress(order.taker),
      sender: asAddress(order.sender),
      feeRecipient: asAddress(order.feeRecipient),
      pool: packedWord(order.pool),
      expiry: asUint(order.expiry, signature),
      salt: asBigint(order.salt),
      takerTokenFillAmount: asBigint(args[2] as bigint | number),
      ...parseSignature(args[1] as RawSignature, signature),
    };
  }

  if (entry.variant === 'fill_rfq_order') {
    const order = args[0] as RawRfqOrder;
    return {
      method: 'zeroex',
      variant: entry.variant,
      signature,
      ...emptyShared(),
      ...withTokens(asAddress(order.takerToken), asAddress(order.makerToken)),
      makerToken: asAddress(order.makerToken),
      takerToken: asAddress(order.takerToken),
      makerAmount: asBigint(order.makerAmount),
      takerAmount: asBigint(order.takerAmount),
      maker: asAddress(order.maker),
      taker: asAddress(order.taker),
      txOrigin: asAddress(order.txOrigin),
      pool: packedWord(order.pool),
      expiry: asUint(order.expiry, signature),
      salt: asBigint(order.salt),
      takerTokenFillAmount: asBigint(args[2] as bigint | number),
      ...parseSignature(args[1] as RawSignature, signature),
    };
  }

  const order = args[0] as RawOtcOrder;
  const expiryAndNonce = asBigint(order.expiryAndNonce);
  return {
    method: 'zeroex',
    variant: entry.variant,
    signature,
    ...emptyShared(),
    ...withTokens(asAddress(order.takerToken), asAddress(order.makerToken)),
    makerToken: asAddress(order.makerToken),
    takerToken: asAddress(order.takerToken),
    makerAmount: asBigint(order.makerAmount),
    takerAmount: asBigint(order.takerAmount),
    maker: asAddress(order.maker),
    taker: asAddress(order.taker),
    txOrigin: asAddress(order.txOrigin),
    expiry: extractZeroExOtcExpiry(expiryAndNonce),
    expiryAndNonce,
    takerTokenFillAmount: asBigint(args[2] as bigint | number),
    ...parseSignature(args[1] as RawSignature, signature),
  };
}
