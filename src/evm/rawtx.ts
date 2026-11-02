import { stripHexPrefix } from './hex';
import { rlpDecodeItem, bytesToBigInt, type RlpValue } from './rlp';

export type ParsedRawTx =
  | { txType: 'eip1559'; chainId: bigint; data: string }
  | { txType: 'legacy'; chainId: bigint | null; data: string };

/**
 * Attempts to parse a raw Ethereum transaction (legacy or EIP-1559 typed-2).
 * On success, returns the extracted calldata as a 0x-prefixed hex string and the chainId when available.
 * Returns null when the input does not appear to be a raw transaction.
 */
export function extractDataAndChainIdFromRawTx(raw: string): ParsedRawTx | null {
  const hex = stripHexPrefix(raw).toLowerCase();
  if (hex.length < 2) return null;

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
    return { txType: 'eip1559', chainId, data };
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
    return { txType: 'legacy', chainId, data };
  } catch {
    return null;
  }
}

