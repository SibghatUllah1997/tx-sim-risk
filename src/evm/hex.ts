export function stripHexPrefix(input: string): string {
  return input.startsWith('0x') || input.startsWith('0X') ? input.slice(2) : input;
}

export function isHexString(hex: string): boolean {
  const h = stripHexPrefix(hex);
  return h.length % 2 === 0 && /^[0-9a-fA-F]*$/.test(h);
}

export function parseAddressFromWord(word: string): string {
  // word is a 32-byte hex string (with or without 0x). Address is the last 20 bytes.
  const clean = stripHexPrefix(word).padStart(64, '0').slice(-64);
  const address = clean.slice(-40);
  return `0x${address.toLowerCase()}`;
}

export function parseUint256FromWord(word: string): bigint {
  const clean = stripHexPrefix(word).padStart(64, '0').slice(-64);
  return BigInt(`0x${clean}`);
}

