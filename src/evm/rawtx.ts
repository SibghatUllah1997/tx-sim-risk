import { stripHexPrefix } from './hex';

type RlpValue = string | RlpValue[];

function readByte(hex: string, idx: number): { byte: number; next: number } {
  const byte = parseInt(hex.slice(idx, idx + 2), 16);
  if (Number.isNaN(byte)) throw new Error('RLP decode: out of bounds');
  return { byte, next: idx + 2 };
}

function readBytes(hex: string, idx: number, n: number): { bytes: string; next: number } {
  const end = idx + n * 2;
  if (end > hex.length) throw new Error('RLP decode: short read');
  return { bytes: hex.slice(idx, end), next: end };
}

function decodeLength(hex: string, idx: number, lenOfLen: number): { len: number; next: number } {
  const { bytes, next } = readBytes(hex, idx, lenOfLen);
  const len = parseInt(bytes, 16);
  if (Number.isNaN(len)) throw new Error('RLP decode: invalid length');
  return { len, next };
}

function rlpDecodeItem(hex: string, idx: number): { value: RlpValue; next: number } {
  const { byte: b0, next: i1 } = readByte(hex, idx);
  // Single byte
  if (b0 <= 0x7f) {
    return { value: hex.slice(idx, idx + 2), next: idx + 2 };
  }
  // Short string
  if (b0 <= 0xb7) {
    const len = b0 - 0x80;
    if (len === 0) return { value: '', next: i1 };
    const { bytes, next } = readBytes(hex, i1, len);
    return { value: bytes, next };
  }
  // Long string
  if (b0 <= 0xbf) {
    const lenOfLen = b0 - 0xb7;
    const { len, next: i2 } = decodeLength(hex, i1, lenOfLen);
    const { bytes, next } = readBytes(hex, i2, len);
    return { value: bytes, next };
  }
  // Short list
  if (b0 <= 0xf7) {
    const payloadLen = b0 - 0xc0;
    const { bytes, next } = readBytes(hex, i1, payloadLen);
    const out: RlpValue[] = [];
    let j = 0;
    while (j < bytes.length) {
      const { value, next: jNext } = rlpDecodeItem(bytes, j);
      out.push(value);
      j = jNext;
    }
    if (j !== bytes.length) throw new Error('RLP decode: list length mismatch');
    return { value: out, next };
  }
  // Long list
  const lenOfLen = b0 - 0xf7;
  const { len, next: i2 } = decodeLength(hex, i1, lenOfLen);
  const { bytes, next } = readBytes(hex, i2, len);
  const out: RlpValue[] = [];
  let j = 0;
  while (j < bytes.length) {
    const { value, next: jNext } = rlpDecodeItem(bytes, j);
    out.push(value);
    j = jNext;
  }
  if (j !== bytes.length) throw new Error('RLP decode: list length mismatch');
  return { value: out, next };
}

function bytesToBigInt(bytesHex: string): bigint {
  if (!bytesHex || bytesHex.length === 0) return 0n;
  return BigInt('0x' + bytesHex);
}

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

