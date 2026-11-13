import {
  isZeroAddress,
  matchSelectorWords,
  parseAddressFromWord,
  parseUint256FromWord,
} from './hex';

export type Erc20TransferDecoded = {
  method: 'erc20_transfer';
  to: string;
  amount: bigint;
  isToZeroAddress: boolean;
};

const TRANSFER_SELECTOR = 'a9059cbb'; // keccak256('transfer(address,uint256)')[0..4]
const TRANSFER_SIGNATURE = 'transfer(address,uint256)';

export function decodeErc20Transfer(data: string): Erc20TransferDecoded | null {
  const words = matchSelectorWords(
    data,
    TRANSFER_SELECTOR,
    2,
    TRANSFER_SIGNATURE
  );
  if (!words) return null;
  const to = parseAddressFromWord(words[0]!);
  const amount = parseUint256FromWord(words[1]!);
  return {
    method: 'erc20_transfer',
    to,
    amount,
    isToZeroAddress: isZeroAddress(to),
  };
}
