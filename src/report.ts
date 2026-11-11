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
import {
  parseSolanaTxSkeleton,
  type SolanaTxSkeleton,
} from './solana/skeleton';
import {
  associatedTokenAccountRisks,
  detectAssociatedTokenAccounts,
  type SolanaAtaInstruction,
} from './solana/ata';
import {
  detectSuspiciousCpi,
  suspiciousCpiRisks,
  type SolanaCpiHit,
} from './solana/cpi';
import type { SuspiciousProgramEntry } from './solana/programs';
import {
  createDecoderRegistry,
  defineChainDecoder,
  type ChainDecoderPlugin,
  type DecoderRegistry,
} from './plugins';

export type ReportOptions = SimOptions & {
  /** Override the built-in phishing index. */
  phishingIndex?: ReadonlyMap<string, PhishingEntry>;
  /** Override the default known-contract map used for spender classification. */
  addressKinds?: ReadonlyMap<string, AddressKind>;
  /** `eth_getCode` results keyed by address; empty/`0x` marks an EOA. */
  bytecodeByAddress?: ReadonlyMap<string, string>;
  /** User allow/block lists (see `loadAddressLists`). */
  lists?: AddressLists;
  /** Override the built-in Solana suspicious-program index. */
  suspiciousPrograms?: ReadonlyMap<string, SuspiciousProgramEntry>;
  /** Override the built-in EVM + Solana decoder registry. */
  decoders?: DecoderRegistry<JsonReport>;
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
    })
  | (ReportMeta & {
      type: 'solana_tx';
      payload: SolanaTxSkeleton & {
        associatedTokenAccounts: SolanaAtaInstruction[];
        suspiciousCpi: SolanaCpiHit[];
      };
    })
  | (ReportMeta & {
      type: 'plugin_decode';
      payload: {
        pluginId: string;
        chain: string;
        summary: string;
        fields: Record<string, string | number | boolean | null>;
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

function solanaReport(
  skeleton: SolanaTxSkeleton,
  options?: ReportOptions
): JsonReport {
  const associatedTokenAccounts = detectAssociatedTokenAccounts(skeleton);
  const suspiciousCpi = detectSuspiciousCpi(
    skeleton,
    options?.suspiciousPrograms
  );
  const risks = [
    ...associatedTokenAccountRisks(associatedTokenAccounts),
    ...suspiciousCpiRisks(suspiciousCpi),
  ];
  return {
    type: 'solana_tx',
    payload: { ...skeleton, associatedTokenAccounts, suspiciousCpi },
    risks,
    riskDetails: describeRisks(risks),
    severity: highestSeverity(risks),
    simulation: emptySimulation(),
  };
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

/** One plain-text line describing an associated token account instruction. */
export function formatAtaLine(ata: SolanaAtaInstruction): string {
  const check =
    ata.matchesDerivation === null
      ? 'unchecked'
      : ata.matchesDerivation
        ? 'derivation ok'
        : `MISMATCH expected ${ata.expectedAddress}`;
  return `ATA [${ata.instructionIndex}] ${ata.kind}: account=${ata.associatedAccount ?? 'unknown'} wallet=${ata.wallet ?? 'unknown'} mint=${ata.mint ?? 'unknown'} (${check})`;
}

/** One plain-text line describing a suspicious Solana CPI hit. */
export function formatCpiLine(hit: SolanaCpiHit): string {
  const role = hit.role === 'invoked' ? 'invoked' : 'cpi-target';
  return `CPI [${hit.instructionIndex}] ${role} ${hit.label} (${hit.category}): ${hit.programId}`;
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
    case 'solana_tx':
      lines.push(`Version: ${report.payload.version}`);
      lines.push(`Fee payer: ${report.payload.feePayer ?? 'unknown'}`);
      lines.push(`Instructions: ${report.payload.instructions.length}`);
      for (const ata of report.payload.associatedTokenAccounts) {
        lines.push(formatAtaLine(ata));
      }
      for (const hit of report.payload.suspiciousCpi) {
        lines.push(formatCpiLine(hit));
      }
      break;
    case 'plugin_decode':
      lines.push(`Plugin: ${report.payload.pluginId}`);
      lines.push(`Chain: ${report.payload.chain}`);
      lines.push(`Summary: ${report.payload.summary}`);
      for (const [key, value] of Object.entries(report.payload.fields)) {
        lines.push(`${key}: ${value}`);
      }
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
 * Build a `plugin_decode` report for a third-party chain decoder. Built-in
 * EVM and Solana plugins use their dedicated report types instead.
 */
export function pluginDecodeReport(
  plugin: Pick<ChainDecoderPlugin<JsonReport>, 'id' | 'name'>,
  spec: {
    summary: string;
    fields?: Record<string, string | number | boolean | null>;
    risks?: string[];
  }
): JsonReport {
  const risks = spec.risks ?? [];
  return {
    type: 'plugin_decode',
    payload: {
      pluginId: plugin.id,
      chain: plugin.name,
      summary: spec.summary,
      fields: spec.fields ?? {},
    },
    risks,
    riskDetails: describeRisks(risks),
    severity: highestSeverity(risks),
    simulation: emptySimulation(),
  };
}

/**
 * Built-in Ethereum decoder: unwraps a raw tx when present, then runs the
 * ERC calldata decoders. Returns null for non-hex or unrecognized input.
 */
export const EVM_DECODER: ChainDecoderPlugin<JsonReport> = defineChainDecoder({
  id: 'evm',
  name: 'Ethereum',
  tryDecode(input, options) {
    const reportOptions = options as ReportOptions | undefined;
    try {
      const unwrapped = extractDataAndChainIdFromRawTx(input);
      if (unwrapped) {
        return generateJsonReport(unwrapped.data, reportOptions);
      }
    } catch {
      // Typed-prefix bytes that are not a well-formed EVM tx fall through.
    }
    try {
      return generateJsonReport(input, reportOptions);
    } catch {
      return null;
    }
  },
});

/**
 * Built-in Solana decoder: parses a legacy/v0 skeleton and attaches ATA
 * plus suspicious-CPI findings.
 */
export const SOLANA_DECODER: ChainDecoderPlugin<JsonReport> = defineChainDecoder({
  id: 'solana',
  name: 'Solana',
  tryDecode(input, options) {
    const skeleton = parseSolanaTxSkeleton(input);
    if (!skeleton) return null;
    return solanaReport(skeleton, options as ReportOptions | undefined);
  },
});

/** Default host registry: EVM first, then Solana. */
export const DEFAULT_DECODER_REGISTRY: DecoderRegistry<JsonReport> =
  createDecoderRegistry([EVM_DECODER, SOLANA_DECODER]);

/**
 * Accepts ERC-20 calldata, a full EVM raw transaction (legacy or typed-2),
 * a serialized Solana transaction (hex or base64), or input claimed by a
 * custom decoder in `options.decoders`. Plugins run in registry order.
 */
export function generateJsonReportFromAny(
  input: string,
  options?: ReportOptions
): JsonReport | null {
  const registry = options?.decoders ?? DEFAULT_DECODER_REGISTRY;
  return registry.decode(input, options);
}

