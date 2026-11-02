import { describe, it, expect } from 'vitest';
import { generateJsonReportFromAny } from '../src/report';

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

describe('report generation from raw tx', () => {
  it('unwraps type-2 raw tx and reports unlimited approve', () => {
    const chainId = 1n;
    const nonce = 0n;
    const maxPriority = 1n;
    const maxFee = 2n;
    const gasLimit = 70000n;
    const to = 'aa'.repeat(20);
    const value = 0n;
    const selector = '095ea7b3'; // approve
    const spender = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const spenderWord = '0'.repeat(24) + spender; // last 20 bytes
    const amountWord = 'f'.repeat(64); // max uint256
    const calldata = selector + spenderWord.padStart(64, '0') + amountWord;
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

    const report = generateJsonReportFromAny(rawTx)!;
    expect(report.type).toBe('erc20_approve');
    // @ts-expect-error narrow type
    expect(report.payload.spender.toLowerCase()).toBe(`0x${spender}`);
    // @ts-expect-error narrow type
    expect(report.payload.isUnlimitedApproval).toBe(true);
  });
});

