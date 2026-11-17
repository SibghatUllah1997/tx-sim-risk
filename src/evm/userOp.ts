import {
  decodeFunctionData,
  parseAbi,
  toFunctionSelector,
  type AbiFunction,
  type Hex,
} from 'viem';
import { isHexString, stripHexPrefix } from './hex';

/** Cap on UserOperations in one `handleOps` batch. */
export const MAX_USER_OPS = 16;

/** Cap on inner account `execute` / `executeBatch` calls. */
export const MAX_ACCOUNT_CALLS = 32;

/** Risk id when a UserOperation names a paymaster in `paymasterAndData`. */
export const ERC4337_PAYMASTER_RISK = 'erc4337_paymaster';

/** Risk id when UserOperation `callData` grants an allowance or operator. */
export const ERC4337_CALLDATA_APPROVAL_RISK = 'erc4337_calldata_approval';

/** EntryPoint ABI version the calldata used. */
export type UserOpVersion = 'v0.6' | 'v0.7';

/** One call the account will make from `callData` (after unwrapping `execute`). */
export type AccountCall = {
  /** Destination. Null when `callData` is not an `execute` wrapper. */
  target: string | null;
  value: bigint;
  data: string;
};

/**
 * Fields shared by EntryPoint v0.6 UserOperation and v0.7
 * PackedUserOperation after unpacking the gas words.
 */
export type DecodedUserOp = {
  sender: string;
  nonce: bigint;
  initCode: string;
  callData: string;
  callGasLimit: bigint;
  verificationGasLimit: bigint;
  preVerificationGas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  paymasterAndData: string;
  /** First 20 bytes of `paymasterAndData`, or null when it is empty. */
  paymaster: string | null;
  signature: string;
  innerCalls: AccountCall[];
};

export type HandleOpsDecoded = {
  method: 'handleOps';
  version: UserOpVersion;
  beneficiary: string;
  ops: DecodedUserOp[];
};

const HANDLE_OPS_ABI: Record<UserOpVersion, string> = {
  'v0.6':
    'function handleOps((address sender, uint256 nonce, bytes initCode, bytes callData, uint256 callGasLimit, uint256 verificationGasLimit, uint256 preVerificationGas, uint256 maxFeePerGas, uint256 maxPriorityFeePerGas, bytes paymasterAndData, bytes signature)[] ops, address beneficiary)',
  'v0.7':
    'function handleOps((address sender, uint256 nonce, bytes initCode, bytes callData, bytes32 accountGasLimits, uint256 preVerificationGas, bytes32 gasFees, bytes paymasterAndData, bytes signature)[] ops, address beneficiary)',
};

const EXECUTE_ABI = parseAbi([
  'function execute(address dest, uint256 value, bytes func)',
]);
const EXECUTE_BATCH_V06_ABI = parseAbi([
  'function executeBatch(address[] dest, bytes[] func)',
]);
const EXECUTE_BATCH_V07_ABI = parseAbi([
  'function executeBatch((address target, uint256 value, bytes data)[] calls)',
]);

const EXECUTE_SELECTOR = toFunctionSelector(EXECUTE_ABI[0] as AbiFunction);
const EXECUTE_BATCH_V06_SELECTOR = toFunctionSelector(
  EXECUTE_BATCH_V06_ABI[0] as AbiFunction
);
const EXECUTE_BATCH_V07_SELECTOR = toFunctionSelector(
  EXECUTE_BATCH_V07_ABI[0] as AbiFunction
);

type CatalogEntry = {
  version: UserOpVersion;
  item: AbiFunction;
  selector: string;
  signature: string;
};

/** Canonical `handleOps` signatures, keyed by EntryPoint version. */
export const HANDLE_OPS_SIGNATURES: Readonly<Record<UserOpVersion, string>> =
  Object.freeze({
    'v0.6':
      'handleOps((address,uint256,bytes,bytes,uint256,uint256,uint256,uint256,uint256,bytes,bytes)[],address)',
    'v0.7':
      'handleOps((address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes)[],address)',
  });

function buildCatalog(): Map<string, CatalogEntry> {
  const bySelector = new Map<string, CatalogEntry>();
  for (const version of Object.keys(HANDLE_OPS_ABI) as UserOpVersion[]) {
    const item = parseAbi([HANDLE_OPS_ABI[version]])[0] as AbiFunction;
    const selector = toFunctionSelector(item);
    bySelector.set(selector, {
      version,
      item,
      selector,
      signature: HANDLE_OPS_SIGNATURES[version],
    });
  }
  return bySelector;
}

const CATALOG = buildCatalog();
const CATALOG_ABI: readonly AbiFunction[] = [...CATALOG.values()].map(
  (entry) => entry.item
);

function asHex(value: string): string {
  return `0x${stripHexPrefix(value).toLowerCase()}`;
}

function asAddress(value: string): string {
  return `0x${stripHexPrefix(value).toLowerCase()}`;
}

function selectorOf(data: string): string | null {
  const hex = stripHexPrefix(data).toLowerCase();
  if (hex.length < 8) return null;
  return `0x${hex.slice(0, 8)}`;
}

function unpackUint128Pair(word: Hex): { high: bigint; low: bigint } {
  const value = BigInt(word);
  const mask = (1n << 128n) - 1n;
  return { high: value >> 128n, low: value & mask };
}

/**
 * Paymaster address packed at the start of `paymasterAndData`.
 * Empty bytes, or fewer than 20 bytes, mean the op pays its own gas.
 */
export function paymasterFromAndData(paymasterAndData: string): string | null {
  const hex = stripHexPrefix(paymasterAndData);
  if (hex.length < 40) return null;
  return `0x${hex.slice(0, 40).toLowerCase()}`;
}

function assertOpCount(count: number, signature: string): void {
  if (count === 0) {
    throw new Error(`handleOps has no user operations in ${signature}`);
  }
  if (count > MAX_USER_OPS) {
    throw new Error(`handleOps batch too large in ${signature}`);
  }
}

function assertCallCount(count: number, signature: string): void {
  if (count > MAX_ACCOUNT_CALLS) {
    throw new Error(`Account execute batch too large in ${signature}`);
  }
}

/**
 * Unwrap Simple Account `execute` / `executeBatch` into the inner calls.
 * Unrecognized `callData` is returned as a single call with no target so
 * the report layer can still run the ERC decoders on the raw bytes.
 */
export function unwrapAccountCalls(callData: string): AccountCall[] {
  if (!isHexString(callData)) {
    throw new Error('Invalid hex data');
  }
  const hex = `0x${stripHexPrefix(callData).toLowerCase()}` as Hex;
  const selector = selectorOf(hex);
  if (!selector) {
    return [{ target: null, value: 0n, data: asHex(hex) }];
  }

  try {
    if (selector === EXECUTE_SELECTOR) {
      const decoded = decodeFunctionData({ abi: EXECUTE_ABI, data: hex });
      const [dest, value, func] = decoded.args as readonly [string, bigint, Hex];
      return [{ target: asAddress(dest), value, data: asHex(func) }];
    }
    if (selector === EXECUTE_BATCH_V06_SELECTOR) {
      const decoded = decodeFunctionData({
        abi: EXECUTE_BATCH_V06_ABI,
        data: hex,
      });
      const [dests, funcs] = decoded.args as readonly [string[], Hex[]];
      if (dests.length !== funcs.length) {
        throw new Error(
          'Malformed arguments for executeBatch(address[],bytes[])'
        );
      }
      assertCallCount(dests.length, 'executeBatch(address[],bytes[])');
      return dests.map((dest, index) => ({
        target: asAddress(dest),
        value: 0n,
        data: asHex(funcs[index]!),
      }));
    }
    if (selector === EXECUTE_BATCH_V07_SELECTOR) {
      const decoded = decodeFunctionData({
        abi: EXECUTE_BATCH_V07_ABI,
        data: hex,
      });
      const calls = (
        decoded.args as readonly [
          readonly { target: string; value: bigint; data: Hex }[],
        ]
      )[0];
      assertCallCount(calls.length, 'executeBatch((address,uint256,bytes)[])');
      return calls.map((call) => ({
        target: asAddress(call.target),
        value: call.value,
        data: asHex(call.data),
      }));
    }
  } catch (err) {
    if (err instanceof Error && /too large|Malformed arguments/.test(err.message)) {
      throw err;
    }
    const name =
      selector === EXECUTE_SELECTOR
        ? 'execute(address,uint256,bytes)'
        : selector === EXECUTE_BATCH_V06_SELECTOR
          ? 'executeBatch(address[],bytes[])'
          : 'executeBatch((address,uint256,bytes)[])';
    throw new Error(`Malformed arguments for ${name}`);
  }

  return [{ target: null, value: 0n, data: asHex(hex) }];
}

type RawV06Op = {
  sender: string;
  nonce: bigint;
  initCode: Hex;
  callData: Hex;
  callGasLimit: bigint;
  verificationGasLimit: bigint;
  preVerificationGas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  paymasterAndData: Hex;
  signature: Hex;
};

type RawV07Op = {
  sender: string;
  nonce: bigint;
  initCode: Hex;
  callData: Hex;
  accountGasLimits: Hex;
  preVerificationGas: bigint;
  gasFees: Hex;
  paymasterAndData: Hex;
  signature: Hex;
};

function finishOp(
  fields: Omit<DecodedUserOp, 'paymaster' | 'innerCalls'>
): DecodedUserOp {
  return {
    ...fields,
    paymaster: paymasterFromAndData(fields.paymasterAndData),
    innerCalls: unwrapAccountCalls(fields.callData),
  };
}

function decodeV06Op(op: RawV06Op): DecodedUserOp {
  return finishOp({
    sender: asAddress(op.sender),
    nonce: op.nonce,
    initCode: asHex(op.initCode),
    callData: asHex(op.callData),
    callGasLimit: op.callGasLimit,
    verificationGasLimit: op.verificationGasLimit,
    preVerificationGas: op.preVerificationGas,
    maxFeePerGas: op.maxFeePerGas,
    maxPriorityFeePerGas: op.maxPriorityFeePerGas,
    paymasterAndData: asHex(op.paymasterAndData),
    signature: asHex(op.signature),
  });
}

function decodeV07Op(op: RawV07Op): DecodedUserOp {
  const gasLimits = unpackUint128Pair(op.accountGasLimits);
  const fees = unpackUint128Pair(op.gasFees);
  return finishOp({
    sender: asAddress(op.sender),
    nonce: op.nonce,
    initCode: asHex(op.initCode),
    callData: asHex(op.callData),
    verificationGasLimit: gasLimits.high,
    callGasLimit: gasLimits.low,
    preVerificationGas: op.preVerificationGas,
    maxPriorityFeePerGas: fees.high,
    maxFeePerGas: fees.low,
    paymasterAndData: asHex(op.paymasterAndData),
    signature: asHex(op.signature),
  });
}

/**
 * Decode EntryPoint `handleOps` (v0.6 or v0.7). Returns null when the
 * selector does not match. Throws on invalid hex or a truncated payload.
 */
export function decodeHandleOps(data: string): HandleOpsDecoded | null {
  if (!isHexString(data)) {
    throw new Error('Invalid hex data');
  }
  const hex = stripHexPrefix(data).toLowerCase();
  if (hex.length < 8) return null;
  const selector = `0x${hex.slice(0, 8)}`;
  const entry = CATALOG.get(selector);
  if (!entry) return null;

  let decoded;
  try {
    decoded = decodeFunctionData({
      abi: CATALOG_ABI,
      data: `0x${hex}`,
    });
  } catch {
    throw new Error(`Malformed arguments for ${entry.signature}`);
  }

  const args = (decoded.args ?? []) as readonly unknown[];
  const beneficiary = asAddress(args[1] as string);

  if (entry.version === 'v0.6') {
    const ops = args[0] as RawV06Op[];
    assertOpCount(ops.length, entry.signature);
    return {
      method: 'handleOps',
      version: entry.version,
      beneficiary,
      ops: ops.map(decodeV06Op),
    };
  }

  const ops = args[0] as RawV07Op[];
  assertOpCount(ops.length, entry.signature);
  return {
    method: 'handleOps',
    version: entry.version,
    beneficiary,
    ops: ops.map(decodeV07Op),
  };
}
