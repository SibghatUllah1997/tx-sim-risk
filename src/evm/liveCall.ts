import {
  BaseError,
  ExecutionRevertedError,
  createPublicClient,
  decodeErrorResult,
  http,
  isAddress,
  type Hex,
  type Transport,
} from 'viem';
import { isHexString, stripHexPrefix } from './hex';
import { extractDataAndChainIdFromRawTx } from './rawtx';

/** Risk id raised when a live `eth_call` of the transaction reverts. */
export const LIVE_CALL_REVERTED_RISK = 'live_call_reverted';

/** Named block tags accepted by `--block`. */
export const LIVE_CALL_BLOCK_TAGS = ['latest', 'pending', 'safe', 'finalized'] as const;

export type LiveCallBlockTag = (typeof LIVE_CALL_BLOCK_TAGS)[number];

/** Default per-request timeout for the RPC, in milliseconds. */
export const LIVE_CALL_TIMEOUT_MS = 10_000;

export type LiveCallRequest = {
  to: string;
  data: string;
  from?: string;
  value: bigint;
  block: LiveCallBlockTag | bigint;
  /** Chain id the input was signed for (raw tx only), checked against the RPC. */
  expectedChainId?: bigint;
};

export type LiveCallStatus = 'success' | 'reverted' | 'error';

/** Outcome of one `eth_call`, shaped for JSON output (no bigints). */
export type LiveCallResult = {
  status: LiveCallStatus;
  to: string;
  from: string | null;
  value: string;
  block: string;
  /** Chain id reported by the RPC, when it answered `eth_chainId`. */
  chainId: string | null;
  /** Return data on success, or raw revert data when the node supplied it. */
  returnData: string | null;
  /** Decoded `Error(string)` / `Panic(uint256)` message, when available. */
  revertReason: string | null;
  /** Transport or validation problem; set only when `status` is `error`. */
  error: string | null;
};

export type LiveCallInputOptions = {
  /** Call target; required for bare calldata, optional check for a raw tx. */
  to?: string;
  from?: string;
  block?: string;
};

function normalizeAddress(value: string, label: string): string {
  if (!isAddress(value, { strict: false })) {
    throw new Error(`${label} must be a 20-byte hex address`);
  }
  return value.toLowerCase();
}

/**
 * Parse a `--block` value: a named tag, a decimal height, or a 0x height.
 * Defaults to `latest`.
 */
export function parseLiveCallBlock(value?: string): LiveCallBlockTag | bigint {
  if (value == null || value === '') return 'latest';
  if ((LIVE_CALL_BLOCK_TAGS as readonly string[]).includes(value)) {
    return value as LiveCallBlockTag;
  }
  if (/^[0-9]+$/.test(value)) return BigInt(value);
  if (/^0x[0-9a-fA-F]+$/.test(value)) return BigInt(value);
  throw new Error(
    `--block must be a block number or one of ${LIVE_CALL_BLOCK_TAGS.join(', ')}`
  );
}

/**
 * Accept only http(s) RPC URLs so a typo cannot reach a file or other scheme.
 */
export function parseRpcUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('--rpc must be an http(s) URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('--rpc must be an http(s) URL');
  }
  return url.toString();
}

/**
 * Turn a CLI payload into an `eth_call` request. A raw EVM transaction
 * supplies its own recipient, value, data, and chain id; bare calldata
 * needs an explicit `to`. Solana payloads and contract creation are refused.
 */
export function liveCallRequestFromPayload(
  payload: string,
  options: LiveCallInputOptions = {}
): LiveCallRequest {
  if (!isHexString(payload)) {
    throw new Error('live calls only support EVM hex input');
  }
  const block = parseLiveCallBlock(options.block);
  const from = options.from ? normalizeAddress(options.from, '--from') : undefined;
  const explicitTo = options.to ? normalizeAddress(options.to, '--to') : undefined;

  const raw = extractDataAndChainIdFromRawTx(payload);
  if (raw) {
    if (raw.to == null) {
      throw new Error('live calls cannot simulate contract creation');
    }
    if (explicitTo && explicitTo !== raw.to) {
      throw new Error(`--to ${explicitTo} does not match the transaction recipient ${raw.to}`);
    }
    const request: LiveCallRequest = {
      to: raw.to,
      data: raw.data,
      value: raw.value,
      block,
    };
    if (from) request.from = from;
    if (raw.chainId != null) request.expectedChainId = raw.chainId;
    return request;
  }

  if (!explicitTo) {
    throw new Error('--to is required to call bare calldata');
  }
  const request: LiveCallRequest = {
    to: explicitTo,
    data: `0x${stripHexPrefix(payload).toLowerCase()}`,
    value: 0n,
    block,
  };
  if (from) request.from = from;
  return request;
}

function hexData(value: unknown): Hex | null {
  if (typeof value === 'string' && /^0x([0-9a-fA-F]{2})*$/.test(value)) {
    return value as Hex;
  }
  if (value && typeof value === 'object' && 'data' in value) {
    return hexData((value as { data: unknown }).data);
  }
  return null;
}

/** First hex `data` field anywhere in the error's cause chain. */
function revertDataOf(err: unknown): Hex | null {
  let current: unknown = err;
  for (let depth = 0; current && depth < 8; depth++) {
    const data = hexData((current as { data?: unknown }).data);
    if (data) return data;
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

/** Decode standard `Error(string)` and `Panic(uint256)` revert payloads. */
export function decodeRevertReason(data: string | null): string | null {
  if (!data || data.length < 10) return null;
  try {
    const decoded = decodeErrorResult({ abi: [], data: data as Hex });
    const [arg] = decoded.args ?? [];
    if (decoded.errorName === 'Panic') return `panic ${String(arg)}`;
    return arg == null ? decoded.errorName : String(arg);
  } catch {
    return null;
  }
}

function isRevert(err: unknown): boolean {
  if (err instanceof BaseError) {
    return err.walk((e) => e instanceof ExecutionRevertedError) != null;
  }
  return false;
}

function errorMessage(err: unknown): string {
  if (err instanceof BaseError) return err.shortMessage;
  return err instanceof Error ? err.message : String(err);
}

export type LiveCallClientOptions = {
  /** Override the HTTP transport (tests pass `custom(...)`). */
  transport?: Transport;
  timeoutMs?: number;
};

/**
 * Run `eth_call` for `request` against `rpcUrl`. Never throws for node
 * or network failures: the outcome is reported in `status`.
 */
export async function runLiveCall(
  rpcUrl: string,
  request: LiveCallRequest,
  options: LiveCallClientOptions = {}
): Promise<LiveCallResult> {
  const client = createPublicClient({
    transport:
      options.transport ??
      http(rpcUrl, {
        timeout: options.timeoutMs ?? LIVE_CALL_TIMEOUT_MS,
        retryCount: 0,
      }),
  });
  const result: LiveCallResult = {
    status: 'error',
    to: request.to,
    from: request.from ?? null,
    value: request.value.toString(),
    block: request.block.toString(),
    chainId: null,
    returnData: null,
    revertReason: null,
    error: null,
  };

  try {
    const chainId = BigInt(await client.getChainId());
    result.chainId = chainId.toString();
    if (request.expectedChainId != null && request.expectedChainId !== chainId) {
      result.error = `RPC chain id ${chainId} does not match transaction chain id ${request.expectedChainId}`;
      return result;
    }
  } catch (err) {
    result.error = errorMessage(err);
    return result;
  }

  const blockArgs =
    typeof request.block === 'bigint'
      ? { blockNumber: request.block }
      : { blockTag: request.block };
  try {
    const { data } = await client.call({
      to: request.to as Hex,
      data: request.data as Hex,
      value: request.value,
      ...(request.from ? { account: request.from as Hex } : {}),
      ...blockArgs,
    });
    result.status = 'success';
    result.returnData = data ?? '0x';
  } catch (err) {
    if (isRevert(err)) {
      result.status = 'reverted';
      result.returnData = revertDataOf(err);
      result.revertReason = decodeRevertReason(result.returnData);
    } else {
      result.error = errorMessage(err);
    }
  }
  return result;
}

/** Risks a live-call result adds to the report. */
export function liveCallRisks(result: LiveCallResult): string[] {
  return result.status === 'reverted' ? [LIVE_CALL_REVERTED_RISK] : [];
}

/** One-line plain-text summary used by the CLI footer. */
export function formatLiveCallLine(result: LiveCallResult): string {
  const where = `Live eth_call (block ${result.block})`;
  if (result.status === 'success') {
    const bytes = result.returnData ? stripHexPrefix(result.returnData).length / 2 : 0;
    return `${where}: success, ${bytes} bytes returned`;
  }
  if (result.status === 'reverted') {
    return `${where}: reverted${result.revertReason ? ` (${result.revertReason})` : ''}`;
  }
  return `${where}: failed (${result.error ?? 'unknown error'})`;
}
