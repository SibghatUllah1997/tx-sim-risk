import { stripHexPrefix } from './hex';
import { rlpDecodeItem, bytesToBigInt, type RlpValue } from './rlp';

/**
 * Parse EIP-1559 (type-2) raw transaction hex and return gas fee fields.
 * Accepts both unsigned (9-field) and signed (12-field) payloads.
 * Returns null when the input is not a typed-2 transaction.
 */
export function parseEip1559Fees(raw: string): {
  maxPriorityFeePerGas: bigint;
  maxFeePerGas: bigint;
  gasLimit: bigint;
} | null {
  const hex = stripHexPrefix(raw).toLowerCase();
  if (!hex.startsWith('02')) return null;
  const payload = hex.slice(2);
  const { value, next } = rlpDecodeItem(payload, 0);
  if (next !== payload.length) {
    // Extra trailing bytes: treat as invalid
    throw new Error('Invalid EIP-1559 transaction encoding');
  }
  if (!Array.isArray(value)) {
    throw new Error('Invalid EIP-1559 transaction: expected list');
  }
  // Unsigned payloads (what a wallet shows before signing) carry 9 fields;
  // signed ones append yParity, r, s for 12. Fee fields sit at the same
  // indices in both, so accept either shape and nothing in between.
  if (value.length !== 9 && value.length !== 12) {
    throw new Error('Invalid EIP-1559 transaction: missing fields');
  }
  const fields = value as RlpValue[];
  const maxPriorityFeePerGas = bytesToBigInt((fields[2] as string) || '');
  const maxFeePerGas = bytesToBigInt((fields[3] as string) || '');
  const gasLimit = bytesToBigInt((fields[4] as string) || '');
  return { maxPriorityFeePerGas, maxFeePerGas, gasLimit };
}

