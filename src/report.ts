import { decodeErc20Approve } from './evm/approval';
import { decodeErc20Transfer } from './evm/transfer';
import {
  decodeErc20IncreaseAllowance,
  decodeErc20DecreaseAllowance,
} from './evm/allowance';
import {
  decodeErc721SetApprovalForAll,
  erc721ApproveAllRisks,
} from './evm/erc721';
import { erc1155ApproveAllRisks } from './evm/erc1155';
import { extractDataAndChainIdFromRawTx } from './evm/rawtx';
import {
  phishingSpenderRisks,
  type PhishingEntry,
} from './evm/phishing';

export type ReportOptions = {
  /** Override the built-in phishing index. */
  phishingIndex?: ReadonlyMap<string, PhishingEntry>;
};

/**
 * Phishing-spender risks for an allowance/operator *grant*.
 * Revocations (zero amount, false approved) are not flagged.
 */
function phishingGrantRisks(
  spender: string,
  granted: boolean,
  options?: ReportOptions
): string[] {
  if (!granted) return [];
  return phishingSpenderRisks(spender, options?.phishingIndex);
}

export type JsonReport =
  | {
      type: 'erc20_approve';
      payload: {
        spender: string;
        amount: string;
        isUnlimitedApproval: boolean;
      };
      risks: string[];
    }
  | {
      type: 'erc20_transfer';
      payload: {
        to: string;
        amount: string;
        isToZeroAddress: boolean;
      };
      risks: string[];
    }
  | {
      type: 'erc20_increaseAllowance';
      payload: {
        spender: string;
        amountDelta: string;
      };
      risks: string[];
    }
  | {
      type: 'erc20_decreaseAllowance';
      payload: {
        spender: string;
        amountDelta: string;
      };
      risks: string[];
    }
  | {
      type: 'nft_setApprovalForAll';
      payload: {
        operator: string;
        approved: boolean;
        isApproveAll: boolean;
        standards: ['erc721', 'erc1155'];
      };
      risks: string[];
    };

export function generateJsonReport(
  data: string,
  options?: ReportOptions
): JsonReport | null {
  const approve = decodeErc20Approve(data);
  if (approve) {
    const risks: string[] = [];
    if (approve.isUnlimitedApproval) risks.push('unlimited_approval');
    risks.push(
      ...phishingGrantRisks(approve.spender, approve.amount > 0n, options)
    );
    return {
      type: 'erc20_approve',
      payload: {
        spender: approve.spender,
        amount: approve.amount.toString(),
        isUnlimitedApproval: approve.isUnlimitedApproval,
      },
      risks,
    };
  }

  const transfer = decodeErc20Transfer(data);
  if (transfer) {
    const risks: string[] = [];
    if (transfer.isToZeroAddress) risks.push('burn_to_zero_address');
    return {
      type: 'erc20_transfer',
      payload: {
        to: transfer.to,
        amount: transfer.amount.toString(),
        isToZeroAddress: transfer.isToZeroAddress,
      },
      risks,
    };
  }

  const inc = decodeErc20IncreaseAllowance(data);
  if (inc) {
    return {
      type: 'erc20_increaseAllowance',
      payload: {
        spender: inc.spender,
        amountDelta: inc.amountDelta.toString(),
      },
      risks: phishingGrantRisks(inc.spender, inc.amountDelta > 0n, options),
    };
  }

  const dec = decodeErc20DecreaseAllowance(data);
  if (dec) {
    return {
      type: 'erc20_decreaseAllowance',
      payload: {
        spender: dec.spender,
        amountDelta: dec.amountDelta.toString(),
      },
      risks: [],
    };
  }

  const nft = decodeErc721SetApprovalForAll(data);
  if (nft) {
    // Same ABI selector as ERC-1155; report both possible standards.
    return {
      type: 'nft_setApprovalForAll',
      payload: {
        operator: nft.operator,
        approved: nft.approved,
        isApproveAll: nft.isApproveAll,
        standards: ['erc721', 'erc1155'],
      },
      risks: [
        ...erc721ApproveAllRisks(data),
        ...erc1155ApproveAllRisks(data),
        ...phishingGrantRisks(nft.operator, nft.approved, options),
      ],
    };
  }

  return null;
}

/**
 * Accepts either ERC-20 calldata (0x...) or a full raw transaction hex (legacy or typed-2).
 * When a raw transaction is provided, unwraps its `data` field before generating the report.
 */
export function generateJsonReportFromAny(
  input: string,
  options?: ReportOptions
): JsonReport | null {
  const unwrapped = extractDataAndChainIdFromRawTx(input);
  const data = unwrapped ? unwrapped.data : input;
  return generateJsonReport(data, options);
}

