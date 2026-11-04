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
  normalizeAddressKey,
  phishingSpenderRisks,
  type PhishingEntry,
} from './evm/phishing';
import {
  classifyAddressKind,
  eoaApprovalRisks,
  type AddressKind,
  type AddressKindHints,
} from './evm/addressKind';

export type ReportOptions = {
  /** Override the built-in phishing index. */
  phishingIndex?: ReadonlyMap<string, PhishingEntry>;
  /** Override the default known-contract map used for spender classification. */
  addressKinds?: ReadonlyMap<string, AddressKind>;
  /** `eth_getCode` results keyed by address; empty/`0x` marks an EOA. */
  bytecodeByAddress?: ReadonlyMap<string, string>;
};

function kindHintsFor(
  address: string,
  options?: ReportOptions
): AddressKindHints {
  const key = normalizeAddressKey(address);
  const bytecode =
    key && options?.bytecodeByAddress
      ? options.bytecodeByAddress.get(key) ??
        options.bytecodeByAddress.get(address)
      : undefined;
  return {
    bytecode,
    known: options?.addressKinds,
  };
}

function spenderKindFor(
  address: string,
  options?: ReportOptions
): AddressKind {
  return classifyAddressKind(address, kindHintsFor(address, options));
}

/**
 * Risks for an allowance/operator *grant*.
 * Revocations (zero amount, false approved) are not flagged.
 */
function approvalGrantRisks(
  spender: string,
  granted: boolean,
  options?: ReportOptions
): string[] {
  if (!granted) return [];
  return [
    ...phishingSpenderRisks(spender, options?.phishingIndex),
    ...eoaApprovalRisks(spender, kindHintsFor(spender, options)),
  ];
}

export type JsonReport =
  | {
      type: 'erc20_approve';
      payload: {
        spender: string;
        amount: string;
        isUnlimitedApproval: boolean;
        spenderKind: AddressKind;
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
        spenderKind: AddressKind;
      };
      risks: string[];
    }
  | {
      type: 'erc20_decreaseAllowance';
      payload: {
        spender: string;
        amountDelta: string;
        spenderKind: AddressKind;
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
        operatorKind: AddressKind;
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
      ...approvalGrantRisks(approve.spender, approve.amount > 0n, options)
    );
    return {
      type: 'erc20_approve',
      payload: {
        spender: approve.spender,
        amount: approve.amount.toString(),
        isUnlimitedApproval: approve.isUnlimitedApproval,
        spenderKind: spenderKindFor(approve.spender, options),
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
        spenderKind: spenderKindFor(inc.spender, options),
      },
      risks: approvalGrantRisks(inc.spender, inc.amountDelta > 0n, options),
    };
  }

  const dec = decodeErc20DecreaseAllowance(data);
  if (dec) {
    return {
      type: 'erc20_decreaseAllowance',
      payload: {
        spender: dec.spender,
        amountDelta: dec.amountDelta.toString(),
        spenderKind: spenderKindFor(dec.spender, options),
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
        operatorKind: spenderKindFor(nft.operator, options),
      },
      risks: [
        ...erc721ApproveAllRisks(data),
        ...erc1155ApproveAllRisks(data),
        ...approvalGrantRisks(nft.operator, nft.approved, options),
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

