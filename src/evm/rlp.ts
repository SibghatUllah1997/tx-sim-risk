export type RlpValue = string | RlpValue[];

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

export function rlpDecodeItem(hex: string, idx: number): { value: RlpValue; next: number } {
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

export function bytesToBigInt(bytesHex: string): bigint {
  if (!bytesHex || bytesHex.length === 0) return 0n;
  return BigInt('0x' + bytesHex);
}

