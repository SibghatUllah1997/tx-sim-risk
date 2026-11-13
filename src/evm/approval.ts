import {
  MAX_UINT256,
  matchSelectorWords,
  parseAddressFromWord,
  parseUint256FromWord,
} from './hex';

export type Erc20ApproveDecoded = {
  method: 'erc20_approve';
  spender: string;
  amount: bigint;
  isUnlimitedApproval: boolean;
};

const APPROVE_SELECTOR = '095ea7b3'; // keccak256('approve(address,uint256)')[0..4]
const APPROVE_SIGNATURE = 'approve(address,uint256)';

/**
 * Decode ERC-20 `approve(address,uint256)`. Returns null when the selector
 * does not match. Throws on invalid hex or a truncated argument section.
 */
export function decodeErc20Approve(data: string): Erc20ApproveDecoded | null {
  const words = matchSelectorWords(data, APPROVE_SELECTOR, 2, APPROVE_SIGNATURE);
  if (!words) return null;
  const spender = parseAddressFromWord(words[0]!);
  const amount = parseUint256FromWord(words[1]!);
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
