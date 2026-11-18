import { stripHexPrefix } from './hex';
import { parseEip7702 } from './eip7702';
import { rlpDecodeItem, bytesToBigInt, type RlpValue } from './rlp';

type RawTxFields = {
  /** Recipient, or null for a contract-creation transaction. */
  to: string | null;
  /** Native value in wei. */
  value: bigint;
  data: string;
};

export type ParsedRawTx =
  | ({ txType: 'eip1559'; chainId: bigint } & RawTxFields)
  | ({ txType: 'eip7702'; chainId: bigint } & RawTxFields)
  | ({ txType: 'legacy'; chainId: bigint | null } & RawTxFields);

function fieldBytes(value: RlpValue | undefined, label: string): string {
  if (value == null) return '';
  if (typeof value !== 'string') {
    throw new Error(`Invalid transaction: ${label} must be bytes`);
  }
  return value;
}

/** RLP `to` field: empty bytes mean contract creation. */
function toAddress(value: RlpValue | undefined): string | null {
  const hex = fieldBytes(value, 'to');
  if (hex.length === 0) return null;
  if (hex.length !== 40) throw new Error('Invalid transaction: to must be 20 bytes');
  return `0x${hex.toLowerCase()}`;
}

/**
 * Attempts to parse a raw Ethereum transaction (legacy or EIP-1559 typed-2).
 * On success, returns the calldata as a 0x-prefixed hex string, the recipient
 * (null for contract creation), the native value in wei, and the chainId when available.
 * Returns null when the input does not appear to be a raw transaction.
 */
export function extractDataAndChainIdFromRawTx(raw: string): ParsedRawTx | null {
  const hex = stripHexPrefix(raw).toLowerCase();
  if (hex.length < 2) return null;

  // Typed transaction (0x04 = EIP-7702). Parse before the generic
  // fallback so a type-4 payload is not treated as unknown calldata.
  if (hex.startsWith('04')) {
    const parsed = parseEip7702(`0x${hex}`);
    if (!parsed) return null;
    return {
      txType: 'eip7702',
      chainId: parsed.chainId,
      to: parsed.to,
      value: parsed.value,
      data: parsed.data,
    };
  }

  // Typed transaction (0x02 = EIP-1559)
  if (hex.startsWith('02')) {
    const payload = hex.slice(2);
    const { value, next } = rlpDecodeItem(payload, 0);
    if (next !== payload.length) throw new Error('Invalid EIP-1559 transaction encoding');
    if (!Array.isArray(value)) throw new Error('Invalid EIP-1559 transaction: expected list');
    const fields = value as RlpValue[];
    if (fields.length < 9) throw new Error('Invalid EIP-1559 transaction: missing fields');
    const chainId = bytesToBigInt((fields[0] as string) || '');
    const dataHex = (fields[7] as string) || '';
    const data = '0x' + dataHex;
    return {
      txType: 'eip1559',
      chainId,
      to: toAddress(fields[5]),
      value: bytesToBigInt(fieldBytes(fields[6], 'value')),
      data,
    };
  }

  // Legacy transaction (untyped RLP list of 9 elements)
  try {
    const { value, next } = rlpDecodeItem(hex, 0);
    if (next !== hex.length) return null; // trailing bytes => not a clean legacy tx
    if (!Array.isArray(value)) return null;
    const fields = value as RlpValue[];
    if (fields.length !== 9) return null;
    const dataHex = (fields[5] as string) || '';
    const vHex = (fields[6] as string) || '';
    const v = bytesToBigInt(vHex);
    let chainId: bigint | null = null;
    // EIP-155: v = chainId * 2 + 35 (+ yParity 0/1)
    if (v >= 35n) {
      chainId = (v - 35n) / 2n;
      if (chainId < 0n) chainId = null;
    } else {
      // Pre-EIP-155 signatures have v=27/28 => unknown chain id
      chainId = null;
    }
    const data = '0x' + dataHex;
    return {
      txType: 'legacy',
      chainId,
      to: toAddress(fields[3]),
      value: bytesToBigInt(fieldBytes(fields[4], 'value')),
      data,
    };
  } catch {
    return null;
  }
}

