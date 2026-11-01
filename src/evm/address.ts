import { keccak_256 } from 'js-sha3';

function stripHexPrefix(input: string): string {
  return input.startsWith('0x') || input.startsWith('0X') ? input.slice(2) : input;
}

function isHex(input: string): boolean {
  return /^[0-9a-fA-F]+$/.test(input);
}

/**
 * Returns true when the string is a 20-byte hex address (40 hex chars) with or without 0x.
 * Does not enforce EIP-55 checksum casing; use isValidChecksumAddress for that.
 */
export function isAddressHexLike(address: string): boolean {
  const hex = stripHexPrefix(address);
  return hex.length === 40 && isHex(hex);
}

/**
 * Compute the EIP-55 checksum-cased address.
 * Input may include 0x and be any casing; output always includes 0x.
 * Throws on invalid (non-hex or wrong length) addresses.
 */
export function toChecksumAddress(address: string): string {
  const raw = stripHexPrefix(address);
  if (raw.length !== 40 || !isHex(raw)) {
    throw new Error('Invalid address format');
  }
  const lower = raw.toLowerCase();
  const hash = keccak_256(lower);
  let out = '';
  for (let i = 0; i < lower.length; i++) {
    const ch = lower[i]!;
    if (ch >= '0' && ch <= '9') {
      out += ch;
      continue;
    }
    const nibble = parseInt(hash[i]!, 16);
    out += nibble >= 8 ? ch.toUpperCase() : ch;
  }
  return `0x${out}`;
}

/**
 * Returns true if the given address uses valid EIP-55 checksum casing.
 * Accepts and ignores the 0x prefix.
 */
export function isValidChecksumAddress(address: string): boolean {
  if (!isAddressHexLike(address)) return false;
  const without = stripHexPrefix(address);
  // All-lower or all-upper are not considered checksummed per EIP-55
  const allLower = without === without.toLowerCase();
  const allUpper = without === without.toUpperCase();
  if (allLower || allUpper) return false;
  try {
    return toChecksumAddress(without) === `0x${without}`;
  } catch {
    return false;
  }
}

/**
 * Looser validity: returns true for
 * - strictly checksummed addresses (EIP-55), OR
 * - all-lowercase hex, OR
 * - all-uppercase hex.
 * Useful when accepting user input that may not be checksummed.
 */
export function isValidAddress(address: string): boolean {
  if (!isAddressHexLike(address)) return false;
  const without = stripHexPrefix(address);
  if (isValidChecksumAddress(address)) return true;
  return without === without.toLowerCase() || without === without.toUpperCase();
}

