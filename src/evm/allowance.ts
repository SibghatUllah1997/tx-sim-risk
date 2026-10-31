export type Erc20IncreaseAllowanceDecoded = {
  method: 'erc20_increaseAllowance';
  spender: string;
  amountDelta: bigint;
};

export type Erc20DecreaseAllowanceDecoded = {
  method: 'erc20_decreaseAllowance';
  spender: string;
  amountDelta: bigint;
};

const INCREASE_ALLOWANCE_SELECTOR = '39509351'; // keccak256('increaseAllowance(address,uint256)')[0..4]
const DECREASE_ALLOWANCE_SELECTOR = 'a457c2d7'; // keccak256('decreaseAllowance(address,uint256)')[0..4]

function stripHexPrefix(hex: string): string {
  return hex.startsWith('0x') ? hex.slice(2) : hex;
}

function isHexString(hex: string): boolean {
  const h = stripHexPrefix(hex);
  return h.length % 2 === 0 && /^[0-9a-fA-F]*$/.test(h);
}

function parseAddressFromWord(word: string): string {
  // word is a 32-byte hex string without 0x. Address is the last 20 bytes.
  const clean = stripHexPrefix(word).padStart(64, '0').slice(-64);
  const address = clean.slice(-40); // last 20 bytes => last 40 hex chars
  return `0x${address.toLowerCase()}`;
}

function parseUint256FromWord(word: string): bigint {
  const clean = stripHexPrefix(word).padStart(64, '0').slice(-64);
  return BigInt(`0x${clean}`);
}

export function decodeErc20IncreaseAllowance(
  data: string
): Erc20IncreaseAllowanceDecoded | null {
  if (!isHexString(data)) {
    throw new Error('Invalid hex data');
  }
  const hex = stripHexPrefix(data).toLowerCase();
  if (hex.length < 8) return null;
  const selector = hex.slice(0, 8);
  if (selector !== INCREASE_ALLOWANCE_SELECTOR) return null;
  // Next words: spender (32 bytes), amount delta (32 bytes)
  const paramsHex = hex.slice(8);
  if (paramsHex.length < 64 * 2) {
    throw new Error(
      'Data too short for increaseAllowance(address,uint256)'
    );
  }
  const spenderWord = paramsHex.slice(0, 64);
  const deltaWord = paramsHex.slice(64, 128);
  const spender = parseAddressFromWord(spenderWord);
  const amountDelta = parseUint256FromWord(deltaWord);
  return {
    method: 'erc20_increaseAllowance',
    spender,
    amountDelta,
  };
}

export function decodeErc20DecreaseAllowance(
  data: string
): Erc20DecreaseAllowanceDecoded | null {
  if (!isHexString(data)) {
    throw new Error('Invalid hex data');
  }
  const hex = stripHexPrefix(data).toLowerCase();
  if (hex.length < 8) return null;
  const selector = hex.slice(0, 8);
  if (selector !== DECREASE_ALLOWANCE_SELECTOR) return null;
  // Next words: spender (32 bytes), amount delta (32 bytes)
  const paramsHex = hex.slice(8);
  if (paramsHex.length < 64 * 2) {
    throw new Error(
      'Data too short for decreaseAllowance(address,uint256)'
    );
  }
  const spenderWord = paramsHex.slice(0, 64);
  const deltaWord = paramsHex.slice(64, 128);
  const spender = parseAddressFromWord(spenderWord);
  const amountDelta = parseUint256FromWord(deltaWord);
  return {
    method: 'erc20_decreaseAllowance',
    spender,
    amountDelta,
  };
}

