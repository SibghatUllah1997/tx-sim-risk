import {
  matchSelectorWords,
  parseAddressFromWord,
  parseBoolFromWord,
} from './hex';

const SET_APPROVAL_FOR_ALL_SELECTOR = 'a22cb465'; // keccak256('setApprovalForAll(address,bool)')[0..4]
const SET_APPROVAL_FOR_ALL_SIGNATURE = 'setApprovalForAll(address,bool)';

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
  const words = matchSelectorWords(
    data,
    SET_APPROVAL_FOR_ALL_SELECTOR,
    2,
    SET_APPROVAL_FOR_ALL_SIGNATURE
  );
  if (!words) return null;
  return {
    operator: parseAddressFromWord(words[0]!),
    approved: parseBoolFromWord(words[1]!),
  };
}
