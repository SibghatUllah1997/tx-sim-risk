import { decodeFunctionData, parseAbi, type Hex } from 'viem';
import { normalizeCalldataHex } from './hex';

/**
 * Which batching ABI the calldata used.
 *
 * - `multicall`, `multicall_deadline`, `multicall_blockhash`: router-style
 *   `multicall(bytes[])` that delegatecalls back into the same contract, so
 *   every inner call keeps the original `msg.sender`.
 * - The `aggregate*` / `*block_and_aggregate` variants are Multicall3: each
 *   inner call goes to its own target with Multicall3 as `msg.sender`.
 */
export type MulticallVariant =
  | 'multicall'
  | 'multicall_deadline'
  | 'multicall_blockhash'
  | 'aggregate'
  | 'try_aggregate'
  | 'aggregate3'
  | 'aggregate3_value'
  | 'block_and_aggregate'
  | 'try_block_and_aggregate';

/** One call carried inside a batch. */
export type MulticallInnerCall = {
  /** Call target. Null for router-style multicall (the router itself). */
  target: string | null;
  /** Calldata for the inner call, 0x-prefixed lowercase hex. */
  data: string;
  /** Per-call `allowFailure` (aggregate3) or the batch-wide flag negated (`requireSuccess`). Null when the ABI has no such flag. */
  allowFailure: boolean | null;
  /** ETH value forwarded with the call (aggregate3Value only). */
  value: bigint | null;
};

export type MulticallDecoded = {
  method: 'multicall';
  variant: MulticallVariant;
  signature: string;
  /** True when inner calls run with Multicall3 as `msg.sender`. */
  forwardsAsContract: boolean;
  /** Router multicall deadline, when the variant has one. */
  deadline: bigint | null;
  /** Router multicall previous block hash, when the variant has one. */
  previousBlockhash: string | null;
  calls: MulticallInnerCall[];
  /** Sum of forwarded ETH (aggregate3Value), otherwise 0. */
  totalValue: bigint;
};

/** Batches larger than this are rejected rather than analyzed partially. */
export const MAX_MULTICALL_CALLS = 256;

type Spec = {
  variant: MulticallVariant;
  signature: string;
  forwardsAsContract: boolean;
};

const SPECS: Readonly<Record<string, Spec>> = Object.freeze({
  ac9650d8: { variant: 'multicall', signature: 'multicall(bytes[])', forwardsAsContract: false },
  '5ae401dc': { variant: 'multicall_deadline', signature: 'multicall(uint256,bytes[])', forwardsAsContract: false },
  '1f0464d1': { variant: 'multicall_blockhash', signature: 'multicall(bytes32,bytes[])', forwardsAsContract: false },
  '252dba42': { variant: 'aggregate', signature: 'aggregate((address,bytes)[])', forwardsAsContract: true },
  bce38bd7: { variant: 'try_aggregate', signature: 'tryAggregate(bool,(address,bytes)[])', forwardsAsContract: true },
  '82ad56cb': { variant: 'aggregate3', signature: 'aggregate3((address,bool,bytes)[])', forwardsAsContract: true },
  '174dea71': { variant: 'aggregate3_value', signature: 'aggregate3Value((address,bool,uint256,bytes)[])', forwardsAsContract: true },
  c3077fa9: { variant: 'block_and_aggregate', signature: 'blockAndAggregate((address,bytes)[])', forwardsAsContract: true },
  '399542e9': { variant: 'try_block_and_aggregate', signature: 'tryBlockAndAggregate(bool,(address,bytes)[])', forwardsAsContract: true },
});

/** Human-readable ABI signature for each batching variant. */
export const MULTICALL_SIGNATURES: Readonly<Record<MulticallVariant, string>> =
  Object.freeze(
    Object.fromEntries(
      Object.values(SPECS).map((spec) => [spec.variant, spec.signature])
    ) as Record<MulticallVariant, string>
  );

const MULTICALL_ABI = parseAbi([
  'function multicall(bytes[] data)',
  'function multicall(uint256 deadline, bytes[] data)',
  'function multicall(bytes32 previousBlockhash, bytes[] data)',
  'function aggregate((address target, bytes callData)[] calls)',
  'function tryAggregate(bool requireSuccess, (address target, bytes callData)[] calls)',
  'function aggregate3((address target, bool allowFailure, bytes callData)[] calls)',
  'function aggregate3Value((address target, bool allowFailure, uint256 value, bytes callData)[] calls)',
  'function blockAndAggregate((address target, bytes callData)[] calls)',
  'function tryBlockAndAggregate(bool requireSuccess, (address target, bytes callData)[] calls)',
]);

type TargetCall = { target: string; callData: string };
type Aggregate3Call = TargetCall & { allowFailure: boolean };
type Aggregate3ValueCall = Aggregate3Call & { value: bigint };

function lower(hex: string): string {
  return hex.toLowerCase();
}

function innerCalls(variant: MulticallVariant, args: readonly unknown[]): MulticallInnerCall[] {
  switch (variant) {
    case 'multicall':
      return (args[0] as readonly string[]).map((data) => ({
        target: null,
        data: lower(data),
        allowFailure: null,
        value: null,
      }));
    case 'multicall_deadline':
    case 'multicall_blockhash':
      return (args[1] as readonly string[]).map((data) => ({
        target: null,
        data: lower(data),
        allowFailure: null,
        value: null,
      }));
    case 'aggregate':
    case 'block_and_aggregate':
      return (args[0] as readonly TargetCall[]).map((call) => ({
        target: lower(call.target),
        data: lower(call.callData),
        allowFailure: false,
        value: null,
      }));
    case 'try_aggregate':
    case 'try_block_and_aggregate': {
      const allowFailure = !(args[0] as boolean);
      return (args[1] as readonly TargetCall[]).map((call) => ({
        target: lower(call.target),
        data: lower(call.callData),
        allowFailure,
        value: null,
      }));
    }
    case 'aggregate3':
      return (args[0] as readonly Aggregate3Call[]).map((call) => ({
        target: lower(call.target),
        data: lower(call.callData),
        allowFailure: call.allowFailure,
        value: null,
      }));
    case 'aggregate3_value':
      return (args[0] as readonly Aggregate3ValueCall[]).map((call) => ({
        target: lower(call.target),
        data: lower(call.callData),
        allowFailure: call.allowFailure,
        value: call.value,
      }));
  }
}

/**
 * Decode a router `multicall` or a Multicall3 `aggregate*` call into its
 * inner calls, or null when the selector is not a known batching ABI.
 * Throws when the selector matches but the payload is malformed, or when
 * the batch holds more than `MAX_MULTICALL_CALLS` calls.
 */
export function decodeMulticall(data: string): MulticallDecoded | null {
  const hex = normalizeCalldataHex(data);
  if (hex.length < 8) return null;
  const spec = SPECS[hex.slice(0, 8)];
  if (!spec) return null;
  let args: readonly unknown[];
  try {
    const decoded = decodeFunctionData({ abi: MULTICALL_ABI, data: `0x${hex}` as Hex });
    args = (decoded.args ?? []) as readonly unknown[];
  } catch {
    throw new Error(`Malformed ${spec.signature} calldata`);
  }
  const calls = innerCalls(spec.variant, args);
  if (calls.length > MAX_MULTICALL_CALLS) {
    throw new Error(
      `Batch has ${calls.length} calls; the limit is ${MAX_MULTICALL_CALLS}`
    );
  }
  const deadline =
    spec.variant === 'multicall_deadline' ? (args[0] as bigint) : null;
  const previousBlockhash =
    spec.variant === 'multicall_blockhash' ? lower(args[0] as string) : null;
  const totalValue = calls.reduce((sum, call) => sum + (call.value ?? 0n), 0n);
  return {
    method: 'multicall',
    variant: spec.variant,
    signature: spec.signature,
    forwardsAsContract: spec.forwardsAsContract,
    deadline,
    previousBlockhash,
    calls,
    totalValue,
  };
}

/** Risk id for an approval or operator grant tucked inside a batch. */
export const MULTICALL_BATCHED_GRANT_RISK = 'multicall_batched_grant';

/** Risk id for a batch nested deeper than the analyzer follows. */
export const MULTICALL_DEPTH_LIMIT_RISK = 'multicall_depth_limit';

/** How many levels of nested batches are analyzed before giving up. */
export const MAX_MULTICALL_DEPTH = 4;
