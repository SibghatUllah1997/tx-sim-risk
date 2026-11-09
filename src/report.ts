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
import { decodeCommonAbi, type AbiDecodedArg, type AbiStandard } from './evm/abi';
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
import {
  blocklistedSpenderRisks,
  isAllowlisted,
  type AddressLists,
} from './config';
import {
  BURN_TO_ZERO_ADDRESS_RISK,
  UNLIMITED_APPROVAL_RISK,
  describeRisks,
  highestSeverity,
  type RiskDetail,
  type RiskSeverity,
} from './risks';
import {
  emptySimulation,
  simulateCalldata,
  type AllowanceDelta,
  type SimOptions,
  type SimulationSnapshot,
} from './sim';

export type ReportOptions = SimOptions & {
  /** Override the built-in phishing index. */
  phishingIndex?: ReadonlyMap<string, PhishingEntry>;
  /** Override the default known-contract map used for spender classification. */
  addressKinds?: ReadonlyMap<string, AddressKind>;
  /** `eth_getCode` results keyed by address; empty/`0x` marks an EOA. */
  bytecodeByAddress?: ReadonlyMap<string, string>;
  /** User allow/block lists (see `loadAddressLists`). */
  lists?: AddressLists;
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
  // The allow list only skips the EOA heuristic. Block-list and phishing
  // hits are always reported, even for an allow-listed address.
  const trusted = isAllowlisted(spender, options?.lists);
  return [
    ...blocklistedSpenderRisks(spender, options?.lists),
    ...phishingSpenderRisks(spender, options?.phishingIndex),
    ...(trusted
      ? []
      : eoaApprovalRisks(spender, kindHintsFor(spender, options))),
  ];
}

type ReportMeta = {
  risks: string[];
  riskDetails: RiskDetail[];
  /** Highest severity among `risks`, or `info` when the list is empty. */
  severity: RiskSeverity;
  simulation: SimulationSnapshot;
};

export type JsonReport =
  | (ReportMeta & {
      type: 'erc20_approve';
      payload: {
        spender: string;
        amount: string;
        isUnlimitedApproval: boolean;
        spenderKind: AddressKind;
      };
    })
  | (ReportMeta & {
      type: 'erc20_transfer';
      payload: {
        to: string;
        amount: string;
        isToZeroAddress: boolean;
      };
    })
  | (ReportMeta & {
      type: 'erc20_increaseAllowance';
      payload: {
        spender: string;
        amountDelta: string;
        spenderKind: AddressKind;
      };
    })
  | (ReportMeta & {
      type: 'erc20_decreaseAllowance';
      payload: {
        spender: string;
        amountDelta: string;
        spenderKind: AddressKind;
      };
    })
  | (ReportMeta & {
      type: 'nft_setApprovalForAll';
      payload: {
        operator: string;
        approved: boolean;
        isApproveAll: boolean;
        standards: ['erc721', 'erc1155'];
        operatorKind: AddressKind;
      };
    })
  | (ReportMeta & {
      type: 'abi_call';
      payload: {
        functionName: string;
        signature: string;
        selector: string;
        standards: AbiStandard[];
        args: AbiDecodedArg[];
      };
    });

function reportMeta(
  risks: string[],
  data: string,
  options?: ReportOptions
): ReportMeta {
  return {
    risks,
    riskDetails: describeRisks(risks),
    severity: highestSeverity(risks),
    simulation:
      simulateCalldata(data, {
        from: options?.from,
        currentAllowance: options?.currentAllowance,
      }) ?? emptySimulation(),
  };
}

export function generateJsonReport(
  data: string,
  options?: ReportOptions
): JsonReport | null {
  const approve = decodeErc20Approve(data);
  if (approve) {
    const risks: string[] = [];
    if (approve.isUnlimitedApproval) risks.push(UNLIMITED_APPROVAL_RISK);
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
      ...reportMeta(risks, data, options),
    };
  }

  const transfer = decodeErc20Transfer(data);
  if (transfer) {
    const risks: string[] = [];
    if (transfer.isToZeroAddress) risks.push(BURN_TO_ZERO_ADDRESS_RISK);
    return {
      type: 'erc20_transfer',
      payload: {
        to: transfer.to,
        amount: transfer.amount.toString(),
        isToZeroAddress: transfer.isToZeroAddress,
      },
      ...reportMeta(risks, data, options),
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
      ...reportMeta(
        approvalGrantRisks(inc.spender, inc.amountDelta > 0n, options),
        data,
        options
      ),
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
      ...reportMeta([], data, options),
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
      ...reportMeta(
        [
          ...erc721ApproveAllRisks(data),
          ...erc1155ApproveAllRisks(data),
          ...approvalGrantRisks(nft.operator, nft.approved, options),
        ],
        data,
        options
      ),
    };
  }

  // Calls without a dedicated risk rule (transferFrom, safeTransferFrom,
  // batch transfers, ...) still get decoded through the generic ABI path.
  const generic = decodeCommonAbi(data);
  if (generic) {
    return {
      type: 'abi_call',
      payload: {
        functionName: generic.functionName,
        signature: generic.signature,
        selector: generic.selector,
        standards: generic.standards,
        args: generic.args,
      },
      ...reportMeta([], data, options),
    };
  }

  return null;
}

function formatSignedDelta(delta: string): string {
  if (delta === '0' || delta.startsWith('-')) return delta;
  return `+${delta}`;
}

function formatAllowanceFooter(change: AllowanceDelta): string {
  const who = change.spender;
  if (change.wouldRevert) {
    return `Allowance (${who}): ${change.mode} would revert`;
  }
  if (change.mode === 'set') {
    return `Allowance (${who}): set to ${change.newValue}`;
  }
  if (change.mode === 'increase') {
    return `Allowance (${who}): +${change.delta}`;
  }
  return `Allowance (${who}): ${change.delta}`;
}

/**
 * Extra plain-text lines for CLI output: spender/operator kind, collected
 * risk ids with reasons, and stub balance/allowance deltas. Empty when
 * there is nothing extra to print.
 */
export function formatReportFooter(report: JsonReport): string[] {
  const lines: string[] = [];
  switch (report.type) {
    case 'erc20_approve':
    case 'erc20_increaseAllowance':
    case 'erc20_decreaseAllowance':
      lines.push(`Spender kind: ${report.payload.spenderKind}`);
      break;
    case 'nft_setApprovalForAll':
      lines.push(`Operator kind: ${report.payload.operatorKind}`);
      break;
    case 'abi_call':
      lines.push(`Standards: ${report.payload.standards.join(', ')}`);
      break;
    default:
      break;
  }
  if (report.risks.length > 0) {
    lines.push(`Severity: ${report.severity}`);
    lines.push(`Risks: ${report.risks.join(', ')}`);
    for (const detail of report.riskDetails) {
      lines.push(
        `Reason: ${detail.id} [${detail.severity}]: ${detail.reason}`
      );
    }
  }
  for (const balance of report.simulation.balances) {
    lines.push(
      `Balance delta (${balance.account}): ${formatSignedDelta(balance.delta)}`
    );
  }
  for (const allowance of report.simulation.allowances) {
    lines.push(formatAllowanceFooter(allowance));
  }
  for (const operator of report.simulation.operators) {
    lines.push(
      `Operator (${operator.operator}): ${operator.approved ? 'granted' : 'revoked'}`
    );
  }
  for (const note of report.simulation.notes) {
    lines.push(`Sim note: ${note}`);
  }
  return lines;
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

