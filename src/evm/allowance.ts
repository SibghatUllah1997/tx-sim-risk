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

import {
  stripHexPrefix,
  isHexString,
  parseAddressFromWord,
  parseUint256FromWord,
} from './hex';

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

