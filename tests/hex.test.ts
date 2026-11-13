import { describe, it, expect } from 'vitest';
import {
  ABI_WORD_HEX_LENGTH,
  MAX_UINT256,
  ZERO_ADDRESS,
  isHexChars,
  isHexString,
  isZeroAddress,
  matchSelectorWords,
  normalizeCalldataHex,
  parseAddressFromWord,
  parseBoolFromWord,
  parseUint256FromWord,
  stripHexPrefix,
} from '../src/evm/hex';

const APPROVE_SELECTOR = '095ea7b3';
const SPENDER = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function word(hexNoPrefix: string): string {
  return hexNoPrefix.padStart(ABI_WORD_HEX_LENGTH, '0');
}

function approve(amountHex: string, extra = ''): string {
  return `0x${APPROVE_SELECTOR}${word(`000000000000000000000000${SPENDER}`)}${word(amountHex)}${extra}`;
}

describe('hex helpers', () => {
  it('strips a 0x prefix of either case and leaves bare hex alone', () => {
    expect(stripHexPrefix('0xabc')).toBe('abc');
    expect(stripHexPrefix('0XABC')).toBe('ABC');
    expect(stripHexPrefix('dead')).toBe('dead');
  });

  it('accepts even-length hex and rejects odd length or non-hex', () => {
    expect(isHexString('0x')).toBe(true);
    expect(isHexString('0xab')).toBe(true);
    expect(isHexString('0xabc')).toBe(false);
    expect(isHexString('0xzz')).toBe(false);
    expect(isHexChars('aF0')).toBe(true);
    expect(isHexChars('')).toBe(false);
    expect(isHexChars('gg')).toBe(false);
  });

  it('normalizes calldata to lowercase bare hex and throws on junk', () => {
    expect(normalizeCalldataHex('0xAB')).toBe('ab');
    expect(normalizeCalldataHex('AB')).toBe('ab');
    expect(() => normalizeCalldataHex('0xzzzz')).toThrow(/invalid hex/i);
  });

  it('parses ABI words for address, uint256, and bool', () => {
    expect(parseAddressFromWord(word(`000000000000000000000000${SPENDER}`))).toBe(
      `0x${SPENDER}`
    );
    expect(parseUint256FromWord(word('ff'))).toBe(255n);
    expect(parseUint256FromWord('f'.repeat(64))).toBe(MAX_UINT256);
    expect(parseBoolFromWord(word('0'))).toBe(false);
    expect(parseBoolFromWord(word('1'))).toBe(true);
    expect(() => parseBoolFromWord(word('2'))).toThrow(/invalid bool/i);
  });

  it('treats the 20-byte zero address as a burn target', () => {
    expect(ZERO_ADDRESS).toBe('0x' + '0'.repeat(40));
    expect(isZeroAddress(ZERO_ADDRESS)).toBe(true);
    expect(isZeroAddress('0x' + '0'.repeat(40).toUpperCase())).toBe(true);
    expect(isZeroAddress(`0x${SPENDER}`)).toBe(false);
  });
});

describe('matchSelectorWords', () => {
  it('returns null for a different selector or a payload shorter than four bytes', () => {
    expect(
      matchSelectorWords(approve('01'), 'a9059cbb', 2, 'transfer(address,uint256)')
    ).toBeNull();
    expect(
      matchSelectorWords('0x095ea7', APPROVE_SELECTOR, 2, 'approve(address,uint256)')
    ).toBeNull();
  });

  it('returns the two ABI words for a well-formed approve call', () => {
    const words = matchSelectorWords(
      approve('0a'),
      APPROVE_SELECTOR,
      2,
      'approve(address,uint256)'
    );
    expect(words).toHaveLength(2);
    expect(parseAddressFromWord(words![0]!)).toBe(`0x${SPENDER}`);
    expect(parseUint256FromWord(words![1]!)).toBe(10n);
  });

  it('ignores extra trailing bytes after the required words', () => {
    const words = matchSelectorWords(
      approve('01', 'deadbeef'),
      APPROVE_SELECTOR,
      2,
      'approve(address,uint256)'
    );
    expect(parseUint256FromWord(words![1]!)).toBe(1n);
  });

  it('throws when the selector matches but the argument section is truncated', () => {
    const truncated = `0x${APPROVE_SELECTOR}${word(`000000000000000000000000${SPENDER}`)}aa`;
    expect(() =>
      matchSelectorWords(
        truncated,
        APPROVE_SELECTOR,
        2,
        'approve(address,uint256)'
      )
    ).toThrow('Data too short for approve(address,uint256)');
  });

  it('throws on invalid hex before looking at the selector', () => {
    expect(() =>
      matchSelectorWords('0xzzzz', APPROVE_SELECTOR, 2, 'approve(address,uint256)')
    ).toThrow(/invalid hex/i);
  });
});
