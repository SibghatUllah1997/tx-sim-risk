import { describe, it, expect } from 'vitest';
import { extractDataAndChainIdFromRawTx } from '../src/evm/rawtx';

// Minimal legacy tx encoding with v=27 (pre-EIP-155), so chainId should be null
function hexFromBigInt(n: bigint): string {
  if (n === 0n) return '';
  let h = n.toString(16);
  if (h.length % 2) h = '0' + h;
  return h;
}

function rlpBytes(h: string): string {
  if (h.length === 0) return '80';
  const len = h.length / 2;
  if (len === 1) {
    const byte = parseInt(h, 16);
    if (byte <= 0x7f) return h.padStart(2, '0');
  }
  if (len < 56) return (0x80 + len).toString(16).padStart(2, '0') + h;
  const lenHex = hexFromBigInt(BigInt(len));
  return (0xb7 + lenHex.length / 2).toString(16) + lenHex + h;
}

function rlpList(items: string[]): string {
  const payload = items.join('');
  const len = payload.length / 2;
  if (len < 56) return (0xc0 + len).toString(16) + payload;
  const lenHex = hexFromBigInt(BigInt(len));
  return (0xf7 + lenHex.length / 2).toString(16) + lenHex + payload;
}

describe('legacy raw tx parsing (pre-EIP-155)', () => {
  it('returns null chainId for v=27', () => {
    const nonce = 0n;
    const gasPrice = 1n;
    const gasLimit = 21000n;
    const to = '11'.repeat(20);
    const value = 0n;
    const data = '';
    const v = 27n; // pre-EIP-155
    const r = '01'.repeat(32);
    const s = '02'.repeat(32);
    const txList = rlpList([
      rlpBytes(hexFromBigInt(nonce)),
      rlpBytes(hexFromBigInt(gasPrice)),
      rlpBytes(hexFromBigInt(gasLimit)),
      rlpBytes(to),
      rlpBytes(hexFromBigInt(value)),
      rlpBytes(data),
      rlpBytes(hexFromBigInt(v)),
      rlpBytes(r),
      rlpBytes(s),
    ]);
    const raw = '0x' + txList;
    const parsed = extractDataAndChainIdFromRawTx(raw)!;
    expect(parsed.txType).toBe('legacy');
    expect(parsed.chainId).toBeNull();
  });
});

