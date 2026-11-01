export type Erc20TransferDecoded = {
  method: 'erc20_transfer';
  to: string;
  amount: bigint;
  isToZeroAddress: boolean;
};

const TRANSFER_SELECTOR = 'a9059cbb'; // keccak256('transfer(address,uint256)')[0..4]

import {
  stripHexPrefix,
  isHexString,
  parseAddressFromWord,
  parseUint256FromWord,
} from './hex';

export function decodeErc20Transfer(data: string): Erc20TransferDecoded | null {
  if (!isHexString(data)) {
    throw new Error('Invalid hex data');
  }
  const hex = stripHexPrefix(data).toLowerCase();
  if (hex.length < 8) return null;
  const selector = hex.slice(0, 8);
  if (selector !== TRANSFER_SELECTOR) return null;
  // Next words: to (32 bytes), amount (32 bytes)
  const paramsHex = hex.slice(8);
  if (paramsHex.length < 64 * 2) {
    throw new Error('Data too short for transfer(address,uint256)');
  }
  const toWord = paramsHex.slice(0, 64);
  const amountWord = paramsHex.slice(64, 128);
  const to = parseAddressFromWord(toWord);
  const amount = parseUint256FromWord(amountWord);
  return {
    method: 'erc20_transfer',
    to,
    amount,
    isToZeroAddress: to.toLowerCase() === '0x' + '0'.repeat(40),
  };
}

