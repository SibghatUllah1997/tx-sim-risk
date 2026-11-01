import { describe, it, expect } from 'vitest';
import {
  isAddressHexLike,
  isValidAddress,
  isValidChecksumAddress,
  toChecksumAddress,
} from '../src/evm/address';

describe('EIP-55 address utilities', () => {
  it('validates basic hex shape', () => {
    expect(isAddressHexLike('0x' + 'a'.repeat(40))).toBe(true);
    expect(isAddressHexLike('0x' + 'A'.repeat(40))).toBe(true);
    expect(isAddressHexLike('0x' + 'g'.repeat(40))).toBe(false);
    expect(isAddressHexLike('0x' + 'a'.repeat(39))).toBe(false);
  });

  it('produces checksummed address and validates it', () => {
    const lower = '0x1234567890abcdef1234567890abcdef12345678';
    const cs = toChecksumAddress(lower);
    expect(cs).toMatch(/^0x[0-9a-fA-F]{40}$/);
    // When letters are present, a correct checksum-cased address validates
    expect(isValidChecksumAddress(cs)).toBe(true);
    expect(isValidAddress(cs)).toBe(true);
  });

  it('accepts all-lower and all-upper as valid non-checksummed', () => {
    const lower = '0x2222222222222222222222222222222222222222';
    const upper = lower.toUpperCase();
    expect(isValidAddress(lower)).toBe(true);
    expect(isValidAddress(upper)).toBe(true);
    expect(isValidChecksumAddress(lower)).toBe(false);
    expect(isValidChecksumAddress(upper)).toBe(false);
  });

  it('rejects malformed inputs', () => {
    expect(() => toChecksumAddress('0x' + '1'.repeat(39))).toThrow(/invalid address/i);
    expect(isValidAddress('0x' + 'z'.repeat(40))).toBe(false);
  });
});

