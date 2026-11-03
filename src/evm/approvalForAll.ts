import {
  stripHexPrefix,
  isHexString,
  parseAddressFromWord,
  parseBoolFromWord,
} from './hex';

const SET_APPROVAL_FOR_ALL_SELECTOR = 'a22cb465'; // keccak256('setApprovalForAll(address,bool)')[0..4]

export type SetApprovalForAllDecoded = {
  operator: string;
  approved: boolean;
};

/**
 * Decode the shared ERC-721 / ERC-1155 ABI for setApprovalForAll(address,bool).
 * Returns null when the selector does not match.
 */
export function decodeSetApprovalForAll(
  data: string
): SetApprovalForAllDecoded | null {
  if (!isHexString(data)) {
    throw new Error('Invalid hex data');
  }
  const hex = stripHexPrefix(data).toLowerCase();
  if (hex.length < 8) return null;
  const selector = hex.slice(0, 8);
  if (selector !== SET_APPROVAL_FOR_ALL_SELECTOR) return null;
  const paramsHex = hex.slice(8);
  if (paramsHex.length < 64 * 2) {
    throw new Error('Data too short for setApprovalForAll(address,bool)');
  }
  const operatorWord = paramsHex.slice(0, 64);
  const approvedWord = paramsHex.slice(64, 128);
  return {
    operator: parseAddressFromWord(operatorWord),
    approved: parseBoolFromWord(approvedWord),
  };
}
