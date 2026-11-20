import {
  decodeFunctionData,
  parseAbi,
  toFunctionSelector,
  type AbiFunction,
  type Hex,
} from 'viem';
import { isHexString, stripHexPrefix } from './hex';

/**
 * Packed ECDSA signatures in a Safe `execTransaction` are 65 bytes each.
 * Shorter blobs cannot satisfy the threshold on their own.
 */
export const SAFE_PACKED_SIGNATURE_BYTES = 65;

/** Which Safe execution ABI the calldata used. */
export type SafeVariant =
  | 'exec_transaction'
  | 'module'
  | 'module_return_data';

/** Safe `Enum.Operation`: 0 = Call, 1 = DelegateCall. */
export type SafeOperation = 'call' | 'delegatecall';

export type SafeDecoded = {
  method: 'safe_exec';
  variant: SafeVariant;
  signature: string;
  to: string;
  value: bigint;
  /** Inner calldata, 0x-prefixed lowercase hex. Empty `0x` is a value transfer. */
  data: string;
  operation: SafeOperation;
  /** Gas limit forwarded to the inner call. Null on module variants. */
  safeTxGas: bigint | null;
  baseGas: bigint | null;
  gasPrice: bigint | null;
  gasToken: string | null;
  refundReceiver: string | null;
  /** Packed signature bytes. Null on module variants. */
  signatures: string | null;
};

const ABI_TEXT: Readonly<Record<SafeVariant, string>> = Object.freeze({
  exec_transaction:
    'function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures)',
  module:
    'function execTransactionFromModule(address to, uint256 value, bytes data, uint8 operation)',
  module_return_data:
    'function execTransactionFromModuleReturnData(address to, uint256 value, bytes data, uint8 operation)',
});

/** Canonical ABI signatures, keyed by variant. */
export const SAFE_SIGNATURES: Readonly<Record<SafeVariant, string>> =
  Object.freeze({
    exec_transaction:
      'execTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes)',
    module: 'execTransactionFromModule(address,uint256,bytes,uint8)',
    module_return_data:
      'execTransactionFromModuleReturnData(address,uint256,bytes,uint8)',
  });

type CatalogEntry = {
  variant: SafeVariant;
  item: AbiFunction;
  selector: string;
};

function buildCatalog(): Map<string, CatalogEntry> {
  const bySelector = new Map<string, CatalogEntry>();
  for (const variant of Object.keys(ABI_TEXT) as SafeVariant[]) {
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

function parseOperation(value: unknown, signature: string): SafeOperation {
  const n = typeof value === 'bigint' ? Number(value) : Number(value);
  if (n === 0) return 'call';
  if (n === 1) return 'delegatecall';
  throw new Error(`Malformed arguments for ${signature}`);
}

/**
 * How many packed 65-byte signatures `signatures` can hold. Module
 * variants have no signature field, so this returns null.
 */
export function packedSignatureCount(
  signatures: string | null | undefined
): number | null {
  if (signatures == null) return null;
  return Math.floor(stripHexPrefix(signatures).length / 2 / SAFE_PACKED_SIGNATURE_BYTES);
}

/** True when `execTransaction` carries at least one packed signature. */
export function hasPackedSignatures(decoded: SafeDecoded): boolean {
  const count = packedSignatureCount(decoded.signatures);
  return count != null && count > 0;
}

/**
 * Decode Gnosis Safe `execTransaction` / `execTransactionFromModule`
 * calldata, or null when the selector is not a known Safe execution ABI.
 * Throws when the selector matches but the arguments are malformed, or
 * when `operation` is not Call (0) or DelegateCall (1).
 */
export function decodeSafeExec(data: string): SafeDecoded | null {
  if (!isHexString(data)) {
    throw new Error('Invalid hex data');
  }
  const hex = stripHexPrefix(data).toLowerCase();
  if (hex.length < 8) return null;
  const selector = `0x${hex.slice(0, 8)}`;
  const entry = CATALOG.get(selector);
  if (!entry) return null;

  const signature = SAFE_SIGNATURES[entry.variant];
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

  const to = asAddress(args[0] as string);
  const value = args[1] as bigint;
  const inner = asHex(args[2] as string);
  const operation = parseOperation(args[3], signature);

  if (entry.variant === 'exec_transaction') {
    return {
      method: 'safe_exec',
      variant: entry.variant,
      signature,
      to,
      value,
      data: inner,
      operation,
      safeTxGas: args[4] as bigint,
      baseGas: args[5] as bigint,
      gasPrice: args[6] as bigint,
      gasToken: asAddress(args[7] as string),
      refundReceiver: asAddress(args[8] as string),
      signatures: asHex(args[9] as string),
    };
  }

  return {
    method: 'safe_exec',
    variant: entry.variant,
    signature,
    to,
    value,
    data: inner,
    operation,
    safeTxGas: null,
    baseGas: null,
    gasPrice: null,
    gasToken: null,
    refundReceiver: null,
    signatures: null,
  };
}
