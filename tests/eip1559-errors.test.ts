import { describe, it, expect } from 'vitest';
import { parseEip1559Fees } from '../src/evm/eip1559';

// Helpers to construct minimal invalid typed-2 payloads
function hex(h: string): string {
  return h.replace(/^0x/, '');
}
function rlpByte(b: number): string {
  return b.toString(16).padStart(2, '0');
}

describe('EIP-1559 parser error paths', () => {
  it('throws when trailing bytes remain', () => {
    // 0xc0 = empty list; add a trailing 00 to cause extra bytes
    const payload = 'c000';
    expect(() => parseEip1559Fees('0x02' + payload)).toThrow(/Invalid EIP-1559 transaction encoding/i);
  });

  it('throws when top-level is not a list', () => {
    // 0x01 = single byte (not a list)
    const payload = rlpByte(0x01);
    expect(() => parseEip1559Fees('0x02' + payload)).toThrow(/expected list/i);
  });

  it('throws when fields are missing', () => {
    // Short list with <12 elements: 0xc1 0x80 => list of one empty string
    const payload = 'c180';
    expect(() => parseEip1559Fees('0x02' + payload)).toThrow(/missing fields/i);
  });
});

