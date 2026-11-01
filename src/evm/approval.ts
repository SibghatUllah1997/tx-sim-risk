export type Erc20ApproveDecoded = {
  method: 'erc20_approve';
  spender: string;
  amount: bigint;
  isUnlimitedApproval: boolean;
};

const APPROVE_SELECTOR = '095ea7b3'; // keccak256('approve(address,uint256)')[0..4]
const MAX_UINT256 = (1n << 256n) - 1n;

import {
  stripHexPrefix,
  isHexString,
  parseAddressFromWord,
  parseUint256FromWord,
} from './hex';

export function decodeErc20Approve(data: string): Erc20ApproveDecoded | null {
  if (!isHexString(data)) {
    throw new Error('Invalid hex data');
  }
  const hex = stripHexPrefix(data).toLowerCase();
  if (hex.length < 8) return null;
  const selector = hex.slice(0, 8);
  if (selector !== APPROVE_SELECTOR) return null;
  // Next words: spender (32 bytes), amount (32 bytes)
  const paramsHex = hex.slice(8);
  if (paramsHex.length < 64 * 2) {
    throw new Error('Data too short for approve(address,uint256)');
  }
  const spenderWord = paramsHex.slice(0, 64);
  const amountWord = paramsHex.slice(64, 128);
  const spender = parseAddressFromWord(spenderWord);
  const amount = parseUint256FromWord(amountWord);
  return {
    method: 'erc20_approve',
    spender,
    amount,
    isUnlimitedApproval: amount === MAX_UINT256,
  };
}

export function isUnlimitedErc20Approval(data: string): boolean {
  const decoded = decodeErc20Approve(data);
  return decoded?.isUnlimitedApproval ?? false;
}

