import { describe, it, expect } from 'vitest';
import { parseEip1559Fees } from '../src/evm/eip1559';

function hexFromBigInt(n: bigint): string {
  if (n === 0n) return '';
  let hex = n.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  return hex;
}

function rlpEncodeBytes(hex: string): string {
  // hex without 0x
  if (hex.length === 0) return '80'; // empty string
  const len = hex.length / 2;
  if (len === 1) {
    const byte = parseInt(hex, 16);
    if (byte <= 0x7f) return hex.padStart(2, '0');
  }
  if (len < 56) {
    const prefix = (0x80 + len).toString(16).padStart(2, '0');
    return prefix + hex;
  }
  const lenHex = hexFromBigInt(BigInt(len));
  const prefix = (0xb7 + lenHex.length / 2).toString(16);
  return prefix + lenHex + hex;
}

function rlpEncodeList(items: string[]): string {
  const payload = items.join('');
  const len = payload.length / 2;
  if (len < 56) {
    const prefix = (0xc0 + len).toString(16);
    return prefix + payload;
  }
  const lenHex = hexFromBigInt(BigInt(len));
  const prefix = (0xf7 + lenHex.length / 2).toString(16);
  return prefix + lenHex + payload;
}

describe('EIP-1559 fee parser', () => {
  it('parses maxPriorityFeePerGas, maxFeePerGas, and gasLimit', () => {
    const chainId = 1n;
    const nonce = 0n;
    const maxPriority = 1n;
    const maxFee = 2n;
    const gasLimit = 21000n; // 0x5208
    const to = '11'.repeat(20); // 20-byte address
    const value = 0n;
    const data = ''; // empty
    const accessList = rlpEncodeList([]); // empty list
    const yParity = 1n;
    const r = '01'.repeat(32);
    const s = '02'.repeat(32);

    const txList = rlpEncodeList([
      rlpEncodeBytes(hexFromBigInt(chainId)),
      rlpEncodeBytes(hexFromBigInt(nonce)),
      rlpEncodeBytes(hexFromBigInt(maxPriority)),
      rlpEncodeBytes(hexFromBigInt(maxFee)),
      rlpEncodeBytes(hexFromBigInt(gasLimit)),
      rlpEncodeBytes(to),
      rlpEncodeBytes(hexFromBigInt(value)),
      rlpEncodeBytes(data),
      accessList,
      rlpEncodeBytes(hexFromBigInt(yParity)),
      rlpEncodeBytes(r),
      rlpEncodeBytes(s),
    ]);
    const rawTx = '0x02' + txList;

    const fees = parseEip1559Fees(rawTx)!;
    expect(fees.maxPriorityFeePerGas).toBe(maxPriority);
    expect(fees.maxFeePerGas).toBe(maxFee);
    expect(fees.gasLimit).toBe(gasLimit);
  });

  it('returns null for non-type-2 tx', () => {
    const notTyped = '0x01abcdef';
    expect(parseEip1559Fees(notTyped)).toBeNull();
  });
});

