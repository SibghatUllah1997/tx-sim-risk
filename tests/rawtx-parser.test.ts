import { describe, it, expect } from 'vitest';
import { extractDataAndChainIdFromRawTx } from '../src/evm/rawtx';

function hexFromBigInt(n: bigint): string {
  if (n === 0n) return '';
  let hex = n.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  return hex;
}

function rlpEncodeBytes(hex: string): string {
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

describe('raw transaction parser', () => {
  it('extracts calldata and chainId from EIP-1559 (type-2) tx', () => {
    const chainId = 1n;
    const nonce = 0n;
    const maxPriority = 1n;
    const maxFee = 2n;
    const gasLimit = 50000n;
    const to = '11'.repeat(20);
    const value = 0n;
    // Simple ERC-20 approve selector with zero params as placeholder
    const selector = '095ea7b3';
    const zeroWord = '0'.repeat(64);
    const calldata = selector + zeroWord + zeroWord;
    const accessList = rlpEncodeList([]);
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
      rlpEncodeBytes(calldata),
      accessList,
      rlpEncodeBytes(hexFromBigInt(yParity)),
      rlpEncodeBytes(r),
      rlpEncodeBytes(s),
    ]);
    const rawTx = '0x02' + txList;

    const parsed = extractDataAndChainIdFromRawTx(rawTx)!;
    expect(parsed.txType).toBe('eip1559');
    expect(parsed.chainId).toBe(chainId);
    expect(parsed.data).toBe('0x' + calldata);
  });

  it('extracts calldata and chainId from legacy EIP-155 tx', () => {
    const nonce = 0n;
    const gasPrice = 100n;
    const gasLimit = 21000n;
    const to = '22'.repeat(20);
    const value = 0n;
    const selector = 'a9059cbb'; // transfer
    const zeroWord = '0'.repeat(64);
    const calldata = selector + zeroWord + zeroWord;
    const chainId = 1n;
    const yParity = 1n;
    const v = chainId * 2n + 35n + yParity; // EIP-155
    const r = '01'.repeat(32);
    const s = '02'.repeat(32);

    const txList = rlpEncodeList([
      rlpEncodeBytes(hexFromBigInt(nonce)),
      rlpEncodeBytes(hexFromBigInt(gasPrice)),
      rlpEncodeBytes(hexFromBigInt(gasLimit)),
      rlpEncodeBytes(to),
      rlpEncodeBytes(hexFromBigInt(value)),
      rlpEncodeBytes(calldata),
      rlpEncodeBytes(hexFromBigInt(v)),
      rlpEncodeBytes(r),
      rlpEncodeBytes(s),
    ]);
    const rawTx = '0x' + txList;

    const parsed = extractDataAndChainIdFromRawTx(rawTx)!;
    expect(parsed.txType).toBe('legacy');
    expect(parsed.chainId).toBe(chainId);
    expect(parsed.data).toBe('0x' + calldata);
  });
});

