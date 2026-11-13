import {
  matchSelectorWords,
  parseAddressFromWord,
  parseUint256FromWord,
} from './hex';

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
const INCREASE_SIGNATURE = 'increaseAllowance(address,uint256)';
const DECREASE_SIGNATURE = 'decreaseAllowance(address,uint256)';

function decodeAllowancePair(
  data: string,
  selector: string,
  signature: string
): { spender: string; amountDelta: bigint } | null {
  const words = matchSelectorWords(data, selector, 2, signature);
  if (!words) return null;
  return {
    spender: parseAddressFromWord(words[0]!),
    amountDelta: parseUint256FromWord(words[1]!),
  };
}

export function decodeErc20IncreaseAllowance(
  data: string
): Erc20IncreaseAllowanceDecoded | null {
  const decoded = decodeAllowancePair(
    data,
    INCREASE_ALLOWANCE_SELECTOR,
    INCREASE_SIGNATURE
  );
  if (!decoded) return null;
  return { method: 'erc20_increaseAllowance', ...decoded };
}

export function decodeErc20DecreaseAllowance(
  data: string
): Erc20DecreaseAllowanceDecoded | null {
  const decoded = decodeAllowancePair(
    data,
    DECREASE_ALLOWANCE_SELECTOR,
    DECREASE_SIGNATURE
  );
  if (!decoded) return null;
  return { method: 'erc20_decreaseAllowance', ...decoded };
}
