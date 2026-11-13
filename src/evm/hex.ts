/** 32-byte ABI word as hex characters, without a 0x prefix. */
export const ABI_WORD_HEX_LENGTH = 64;

/** Maximum uint256 value. Used for unlimited-approval checks. */
export const MAX_UINT256 = (1n << 256n) - 1n;

/** 20-byte zero address, lowercase and 0x-prefixed. */
export const ZERO_ADDRESS = `0x${'0'.repeat(40)}`;

/** Strip a leading 0x / 0X prefix. Leaves already-bare hex unchanged. */
export function stripHexPrefix(input: string): string {
  return input.startsWith('0x') || input.startsWith('0X') ? input.slice(2) : input;
}

/**
 * True when `hex` is even-length hexadecimal, with or without a 0x prefix.
 * Empty `0x` / `` is accepted (zero bytes).
 */
export function isHexString(hex: string): boolean {
  const h = stripHexPrefix(hex);
  return h.length % 2 === 0 && /^[0-9a-fA-F]*$/.test(h);
}

/** True when every character of `input` is a hex digit. Empty strings are false. */
export function isHexChars(input: string): boolean {
  return input.length > 0 && /^[0-9a-fA-F]+$/.test(input);
}

/**
 * Lowercase hex without the 0x prefix. Throws when the string is not
 * even-length hexadecimal.
 */
export function normalizeCalldataHex(data: string): string {
  if (!isHexString(data)) {
    throw new Error('Invalid hex data');
  }
  return stripHexPrefix(data).toLowerCase();
}

/**
 * If `data` is a call whose 4-byte selector equals `selector`, return the
 * following `wordCount` ABI words. Returns null when the selector does not
 * match or the payload is shorter than four bytes. Throws when the selector
 * matches but the argument section is truncated.
 *
 * `selector` is 8 hex characters without 0x. Extra trailing bytes after the
 * required words are ignored, matching how the EVM reads ABI arguments.
 */
export function matchSelectorWords(
  data: string,
  selector: string,
  wordCount: number,
  signature: string
): string[] | null {
  const hex = normalizeCalldataHex(data);
  if (hex.length < 8) return null;
  if (hex.slice(0, 8) !== selector.toLowerCase()) return null;
  const paramsHex = hex.slice(8);
  const needed = ABI_WORD_HEX_LENGTH * wordCount;
  if (paramsHex.length < needed) {
    throw new Error(`Data too short for ${signature}`);
  }
  const words: string[] = [];
  for (let i = 0; i < wordCount; i++) {
    const start = i * ABI_WORD_HEX_LENGTH;
    words.push(paramsHex.slice(start, start + ABI_WORD_HEX_LENGTH));
  }
  return words;
}

/**
 * Read a 20-byte address from a 32-byte ABI word (with or without 0x).
 * The address is the last 20 bytes, returned lowercase and 0x-prefixed.
 */
export function parseAddressFromWord(word: string): string {
  const clean = stripHexPrefix(word).padStart(64, '0').slice(-64);
  const address = clean.slice(-40);
  return `0x${address.toLowerCase()}`;
}

/** Read a uint256 from a 32-byte ABI word (with or without 0x). */
export function parseUint256FromWord(word: string): bigint {
  const clean = stripHexPrefix(word).padStart(64, '0').slice(-64);
  return BigInt(`0x${clean}`);
}

/**
 * Decode an ABI-encoded bool (32-byte word). Only 0 and 1 are valid.
 */
export function parseBoolFromWord(word: string): boolean {
  const value = parseUint256FromWord(word);
  if (value === 0n) return false;
  if (value === 1n) return true;
  throw new Error('Invalid bool ABI word');
}

/** True when `address` is the 20-byte zero address, ignoring case and 0x. */
export function isZeroAddress(address: string): boolean {
  return stripHexPrefix(address).toLowerCase() === stripHexPrefix(ZERO_ADDRESS);
}
