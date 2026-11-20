import { decodeErc20Approve } from './evm/approval';
import { decodeErc20Transfer } from './evm/transfer';
import {
  decodeErc20Permit,
  unlimitedPermitRisks,
  UNLIMITED_PERMIT_RISK,
  type PermitVariant,
} from './evm/permit';
import {
  decodePermit2,
  permit2ExpiryRisks,
  permit2UnlimitedApproval,
  permit2UnlimitedPermit,
  type Permit2Decoded,
  type Permit2Variant,
} from './evm/permit2';
import {
  decodeMulticall,
  MAX_MULTICALL_DEPTH,
  MULTICALL_BATCHED_GRANT_RISK,
  MULTICALL_DEPTH_LIMIT_RISK,
  type MulticallDecoded,
  type MulticallVariant,
} from './evm/multicall';
import {
  decodeHandleOps,
  ERC4337_CALLDATA_APPROVAL_RISK,
  ERC4337_PAYMASTER_RISK,
  type HandleOpsDecoded,
  type UserOpVersion,
} from './evm/userOp';
import {
  decodeSafeExec,
  packedSignatureCount,
  type SafeDecoded,
  type SafeOperation,
  type SafeVariant,
} from './evm/safe';
import {
  EIP7702_BROAD_DELEGATE_RISK,
  EIP7702_DELEGATION_RISK,
  hasEip7702BroadDelegate,
  hasEip7702Delegation,
  parseEip7702,
  type Eip7702Decoded,
} from './evm/eip7702';
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
import { extractDataAndChainIdFromRawTx, type ParsedRawTx } from './evm/rawtx';
import { nativeValueCallRisks } from './evm/nativeValue';
import { isZeroAddress } from './evm/hex';
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
  formatAddressLabel,
  lookupAddressLabel,
  type AddressLabel,
  type CatalogEntry,
} from './evm/catalog';
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
  detectSplTokenInstructions,
  splTokenRisks,
  type SolanaSplInstruction,
} from './solana/splToken';
import {
  detectSuspiciousCpi,
  suspiciousCpiRisks,
  type SolanaCpiHit,
} from './solana/cpi';
import type { SuspiciousProgramEntry } from './solana/programs';
import { formatLiveCallLine, type LiveCallResult } from './evm/liveCall';
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
  /** Override the built-in router / bridge / token label catalog. */
  catalog?: ReadonlyMap<string, CatalogEntry>;
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

function labelFor(
  address: string | null | undefined,
  options?: ReportOptions
): AddressLabel | null {
  return lookupAddressLabel(address, options?.catalog);
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
  /** Present only when a live `eth_call` was requested with `--rpc`. */
  liveCall?: LiveCallResult;
};

export type JsonReport =
  | (ReportMeta & {
      type: 'erc20_approve';
      payload: {
        spender: string;
        amount: string;
        isUnlimitedApproval: boolean;
        spenderKind: AddressKind;
        spenderLabel: AddressLabel | null;
      };
    })
  | (ReportMeta & {
      type: 'erc20_permit';
      payload: {
        variant: PermitVariant;
        owner: string;
        spender: string;
        value: string;
        deadline: string;
        nonce: string | null;
        allowed: boolean | null;
        isUnlimitedPermit: boolean;
        hasNoExpiry: boolean;
        spenderKind: AddressKind;
        spenderLabel: AddressLabel | null;
      };
    })
  | (ReportMeta & {
      type: 'permit2';
      payload: {
        variant: Permit2Variant;
        owner: string | null;
        spender: string | null;
        token: string;
        amount: string;
        expiration: string | null;
        deadline: string | null;
        nonce: string | null;
        to: string | null;
        requestedAmount: string | null;
        allowances: {
          token: string;
          amount: string;
          expiration: string;
          nonce: string | null;
        }[];
        isUnlimited: boolean;
        hasNoExpiry: boolean;
        spenderKind: AddressKind | null;
        spenderLabel: AddressLabel | null;
        toLabel: AddressLabel | null;
      };
    })
  | (ReportMeta & {
      type: 'multicall';
      payload: {
        variant: MulticallVariant;
        signature: string;
        forwardsAsContract: boolean;
        deadline: string | null;
        previousBlockhash: string | null;
        totalValue: string;
        calls: MulticallCallReport[];
      };
    })
  | (ReportMeta & {
      type: 'erc4337_userop';
      payload: {
        version: UserOpVersion;
        beneficiary: string;
        ops: UserOpReport[];
      };
    })
  | (ReportMeta & {
      type: 'safe_exec';
      payload: {
        variant: SafeVariant;
        signature: string;
        to: string;
        value: string;
        data: string;
        operation: SafeOperation;
        safeTxGas: string | null;
        baseGas: string | null;
        gasPrice: string | null;
        gasToken: string | null;
        refundReceiver: string | null;
        signatures: string | null;
        signatureCount: number | null;
        targetKind: AddressKind;
        targetLabel: AddressLabel | null;
        innerReport: JsonReport | null;
        depthLimited: boolean;
      };
    })
  | (ReportMeta & {
      type: 'eip7702';
      payload: {
        chainId: string;
        nonce: string;
        to: string | null;
        value: string;
        data: string;
        authorizations: {
          chainId: string;
          address: string;
          nonce: string;
          yParity: string;
          r: string;
          s: string;
          isAnyChain: boolean;
          isRevocation: boolean;
          delegateKind: AddressKind;
          delegateLabel: AddressLabel | null;
        }[];
        innerReport: JsonReport | null;
      };
    })
  | (ReportMeta & {
      type: 'native_transfer';
      payload: {
        txType: ParsedRawTx['txType'];
        chainId: string | null;
        /** Recipient, or null when the tx creates a contract. */
        to: string | null;
        /** Native value in wei. */
        value: string;
        recipientKind: AddressKind | null;
        recipientLabel: AddressLabel | null;
        isToZeroAddress: boolean;
      };
    })
  | (ReportMeta & {
      type: 'erc20_transfer';
      payload: {
        to: string;
        amount: string;
        isToZeroAddress: boolean;
        toLabel: AddressLabel | null;
      };
    })
  | (ReportMeta & {
      type: 'erc20_increaseAllowance';
      payload: {
        spender: string;
        amountDelta: string;
        spenderKind: AddressKind;
        spenderLabel: AddressLabel | null;
      };
    })
  | (ReportMeta & {
      type: 'erc20_decreaseAllowance';
      payload: {
        spender: string;
        amountDelta: string;
        spenderKind: AddressKind;
        spenderLabel: AddressLabel | null;
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
        operatorLabel: AddressLabel | null;
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
        splTokenInstructions: SolanaSplInstruction[];
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

/** One inner call recovered from account `execute` / `executeBatch`. */
export type UserOpCallReport = {
  target: string | null;
  value: string;
  data: string;
  report: JsonReport | null;
};

/** One UserOperation inside an EntryPoint `handleOps` report. */
export type UserOpReport = {
  sender: string;
  nonce: string;
  initCode: string;
  callData: string;
  callGasLimit: string;
  verificationGasLimit: string;
  preVerificationGas: string;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
  paymasterAndData: string;
  paymaster: string | null;
  signature: string;
  calls: UserOpCallReport[];
};

/** One inner call of a `multicall` report with its own nested report. */
export type MulticallCallReport = {
  index: number;
  target: string | null;
  allowFailure: boolean | null;
  value: string | null;
  /** First four bytes of the inner calldata, or null when shorter. */
  selector: string | null;
  /** Report for the inner calldata, or null when nothing decodes it. */
  report: JsonReport | null;
  /** True when the inner call is a batch nested past the depth limit. */
  depthLimited: boolean;
};

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

function stringifyNullable(value: bigint | null): string | null {
  return value == null ? null : value.toString();
}

function permit2GrantsValue(decoded: Permit2Decoded): boolean {
  if (decoded.isUnlimited || decoded.amount > 0n) return true;
  if ((decoded.requestedAmount ?? 0n) > 0n) return true;
  return decoded.allowances.some((item) => item.amount > 0n);
}

function permit2Risks(
  decoded: Permit2Decoded,
  options?: ReportOptions
): string[] {
  const risks: string[] = [];
  if (permit2UnlimitedApproval(decoded)) risks.push(UNLIMITED_APPROVAL_RISK);
  if (permit2UnlimitedPermit(decoded)) risks.push(UNLIMITED_PERMIT_RISK);
  risks.push(...permit2ExpiryRisks(decoded));
  if (decoded.spender) {
    risks.push(
      ...approvalGrantRisks(decoded.spender, permit2GrantsValue(decoded), options)
    );
  } else if (decoded.to && permit2GrantsValue(decoded)) {
    risks.push(
      ...blocklistedSpenderRisks(decoded.to, options?.lists),
      ...phishingSpenderRisks(decoded.to, options?.phishingIndex)
    );
  }
  return risks;
}

function permit2Payload(
  decoded: Permit2Decoded,
  options?: ReportOptions
): Extract<JsonReport, { type: 'permit2' }>['payload'] {
  return {
    variant: decoded.variant,
    owner: decoded.owner,
    spender: decoded.spender,
    token: decoded.token,
    amount: decoded.amount.toString(),
    expiration: stringifyNullable(decoded.expiration),
    deadline: stringifyNullable(decoded.deadline),
    nonce: stringifyNullable(decoded.nonce),
    to: decoded.to,
    requestedAmount: stringifyNullable(decoded.requestedAmount),
    allowances: decoded.allowances.map((item) => ({
      token: item.token,
      amount: item.amount.toString(),
      expiration: item.expiration.toString(),
      nonce: stringifyNullable(item.nonce),
    })),
    isUnlimited: decoded.isUnlimited,
    hasNoExpiry: decoded.hasNoExpiry,
    spenderKind: decoded.spender
      ? spenderKindFor(decoded.spender, options)
      : null,
    spenderLabel: labelFor(decoded.spender, options),
    toLabel: labelFor(decoded.to, options),
  };
}

/**
 * Canonical Multicall3 deployment (same address on most EVM chains). Inner
 * Multicall3 calls run with this contract as `msg.sender`, so the stub
 * simulation records their effects against it rather than the signer.
 */
export const MULTICALL3_ADDRESS = '0xca11bde05977b3631167028862be2a173976ca11';

/** True when the report grants an allowance, permit, or operator approval. */
function grantsAccess(report: JsonReport): boolean {
  switch (report.type) {
    case 'erc20_approve':
      return report.payload.amount !== '0';
    case 'erc20_permit':
      return report.payload.value !== '0' || report.payload.allowed === true;
    case 'permit2':
      return (
        report.payload.spender != null &&
        (report.payload.amount !== '0' ||
          report.payload.allowances.some((item) => item.amount !== '0'))
      );
    case 'erc20_increaseAllowance':
      return report.payload.amountDelta !== '0';
    case 'nft_setApprovalForAll':
      return report.payload.approved;
    case 'multicall':
      return report.payload.calls.some(
        (call) => call.report != null && grantsAccess(call.report)
      );
    case 'erc4337_userop':
      return report.payload.ops.some((op) =>
        op.calls.some((call) => call.report != null && grantsAccess(call.report))
      );
    case 'eip7702':
      return report.payload.innerReport != null && grantsAccess(report.payload.innerReport);
    case 'safe_exec':
      return (
        report.payload.innerReport != null && grantsAccess(report.payload.innerReport)
      );
    default:
      return false;
  }
}

function isBatch(data: string): boolean {
  try {
    return decodeMulticall(data) != null;
  } catch {
    return true;
  }
}

function pushUnique(target: string[], items: readonly string[]): void {
  for (const item of items) {
    if (!target.includes(item)) target.push(item);
  }
}

function multicallReport(
  decoded: MulticallDecoded,
  options: ReportOptions | undefined,
  depth: number
): JsonReport {
  // Router multicall delegatecalls into itself, so the signer stays the
  // owner. Multicall3 calls each target as itself. A known prior allowance
  // only describes one (owner, spender) pair, so it is not reused inside
  // a batch.
  const innerOptions: ReportOptions = {
    ...options,
    from: decoded.forwardsAsContract ? MULTICALL3_ADDRESS : options?.from,
    currentAllowance: undefined,
  };
  const risks: string[] = [];
  const simulation = emptySimulation();
  let batchedGrant = false;
  let depthLimited = false;
  const calls = decoded.calls.map((call, index): MulticallCallReport => {
    const hexBody = call.data.slice(2);
    const selector = hexBody.length >= 8 ? `0x${hexBody.slice(0, 8)}` : null;
    const tooDeep = depth + 1 >= MAX_MULTICALL_DEPTH && isBatch(call.data);
    let report: JsonReport | null = null;
    if (tooDeep) {
      depthLimited = true;
    } else {
      try {
        report = generateJsonReportAt(call.data, innerOptions, depth + 1);
      } catch {
        report = null;
      }
    }
    if (report) {
      pushUnique(risks, report.risks);
      if (grantsAccess(report)) batchedGrant = true;
      simulation.balances.push(...report.simulation.balances);
      simulation.allowances.push(...report.simulation.allowances);
      simulation.operators.push(...report.simulation.operators);
      pushUnique(simulation.notes, report.simulation.notes);
    }
    return {
      index,
      target: call.target,
      allowFailure: call.allowFailure,
      value: call.value != null ? call.value.toString() : null,
      selector,
      report,
      depthLimited: tooDeep,
    };
  });
  if (batchedGrant) pushUnique(risks, [MULTICALL_BATCHED_GRANT_RISK]);
  if (depthLimited) pushUnique(risks, [MULTICALL_DEPTH_LIMIT_RISK]);
  if (decoded.forwardsAsContract) {
    pushUnique(simulation.notes, [
      'Multicall3 makes each inner call as itself, so approvals and transfers act on the Multicall3 contract unless a smart account executes the batch on your behalf.',
    ]);
  }
  return {
    type: 'multicall',
    payload: {
      variant: decoded.variant,
      signature: decoded.signature,
      forwardsAsContract: decoded.forwardsAsContract,
      deadline: stringifyNullable(decoded.deadline),
      previousBlockhash: decoded.previousBlockhash,
      totalValue: decoded.totalValue.toString(),
      calls,
    },
    risks,
    riskDetails: describeRisks(risks),
    severity: highestSeverity(risks),
    simulation,
  };
}

function mergeSimulation(
  into: SimulationSnapshot,
  from: SimulationSnapshot
): void {
  into.balances.push(...from.balances);
  into.allowances.push(...from.allowances);
  into.operators.push(...from.operators);
  pushUnique(into.notes, from.notes);
}

function safeExecReport(
  decoded: SafeDecoded,
  options: ReportOptions | undefined,
  depth: number
): JsonReport {
  const risks: string[] = [];
  const simulation = emptySimulation();
  let innerReport: JsonReport | null = null;
  const tooDeep =
    decoded.data !== '0x' && depth + 1 >= MAX_MULTICALL_DEPTH;
  if (decoded.data !== '0x' && !tooDeep) {
    try {
      innerReport = generateJsonReportAt(decoded.data, options, depth + 1);
    } catch {
      innerReport = null;
    }
  }
  if (innerReport) {
    pushUnique(risks, innerReport.risks);
    pushUnique(risks, nativeValueCallRisks(innerReport.type, decoded.value));
    mergeSimulation(simulation, innerReport.simulation);
  }
  if (decoded.value > 0n) {
    pushUnique(simulation.notes, [nativeValueNote(decoded.value, decoded.to)]);
  }
  pushUnique(simulation.notes, [
    'Inner call runs as the Safe contract, not the owner who submitted execTransaction.',
  ]);
  return {
    type: 'safe_exec',
    payload: {
      variant: decoded.variant,
      signature: decoded.signature,
      to: decoded.to,
      value: decoded.value.toString(),
      data: decoded.data,
      operation: decoded.operation,
      safeTxGas: stringifyNullable(decoded.safeTxGas),
      baseGas: stringifyNullable(decoded.baseGas),
      gasPrice: stringifyNullable(decoded.gasPrice),
      gasToken: decoded.gasToken,
      refundReceiver: decoded.refundReceiver,
      signatures: decoded.signatures,
      signatureCount: packedSignatureCount(decoded.signatures),
      targetKind: spenderKindFor(decoded.to, options),
      targetLabel: labelFor(decoded.to, options),
      innerReport,
      depthLimited: tooDeep,
    },
    risks,
    riskDetails: describeRisks(risks),
    severity: highestSeverity(risks),
    simulation,
  };
}

function userOpReport(
  decoded: HandleOpsDecoded,
  options: ReportOptions | undefined,
  depth: number
): JsonReport {
  const risks: string[] = [];
  const innerRisks: string[] = [];
  const simulation = emptySimulation();
  let calldataGrant = false;
  const paymasters: string[] = [];
  for (const op of decoded.ops) {
    if (op.paymaster) pushUnique(paymasters, [op.paymaster]);
  }
  if (paymasters.length > 0) pushUnique(risks, [ERC4337_PAYMASTER_RISK]);
  for (const paymaster of paymasters) {
    pushUnique(risks, [
      ...blocklistedSpenderRisks(paymaster, options?.lists),
      ...phishingSpenderRisks(paymaster, options?.phishingIndex),
    ]);
  }
  const ops: UserOpReport[] = decoded.ops.map((op) => {
    const innerOptions: ReportOptions = {
      ...options,
      from: op.sender,
      currentAllowance: undefined,
    };
    const calls: UserOpCallReport[] = op.innerCalls.map((call) => {
      let report: JsonReport | null = null;
      if (depth + 1 < MAX_MULTICALL_DEPTH) {
        try {
          report = generateJsonReportAt(call.data, innerOptions, depth + 1);
        } catch {
          report = null;
        }
      }
      if (report) {
        pushUnique(innerRisks, report.risks);
        if (grantsAccess(report)) calldataGrant = true;
        mergeSimulation(simulation, report.simulation);
      }
      return {
        target: call.target,
        value: call.value.toString(),
        data: call.data,
        report,
      };
    });
    return {
      sender: op.sender,
      nonce: op.nonce.toString(),
      initCode: op.initCode,
      callData: op.callData,
      callGasLimit: op.callGasLimit.toString(),
      verificationGasLimit: op.verificationGasLimit.toString(),
      preVerificationGas: op.preVerificationGas.toString(),
      maxFeePerGas: op.maxFeePerGas.toString(),
      maxPriorityFeePerGas: op.maxPriorityFeePerGas.toString(),
      paymasterAndData: op.paymasterAndData,
      paymaster: op.paymaster,
      signature: op.signature,
      calls,
    };
  });
  if (calldataGrant) pushUnique(risks, [ERC4337_CALLDATA_APPROVAL_RISK]);
  pushUnique(risks, innerRisks);
  pushUnique(simulation.notes, [
    'ERC-4337 handleOps runs each UserOperation from the account sender; a paymaster, if present, only sponsors gas.',
  ]);
  return {
    type: 'erc4337_userop',
    payload: {
      version: decoded.version,
      beneficiary: decoded.beneficiary,
      ops,
    },
    risks,
    riskDetails: describeRisks(risks),
    severity: highestSeverity(risks),
    simulation,
  };
}

function nativeValueNote(value: bigint, to: string | null): string {
  return to
    ? `Sends ${value} wei of native ETH to ${to}.`
    : `Sends ${value} wei of native ETH into the contract being created.`;
}

/**
 * Report for a raw tx with empty calldata: a plain native-value transfer
 * (or a zero-value self-cancel). The recipient gets the block-list and
 * phishing checks a spender would get.
 */
function nativeTransferReport(
  tx: ParsedRawTx,
  options?: ReportOptions
): JsonReport {
  const risks: string[] = [];
  const toZero = tx.to != null && isZeroAddress(tx.to);
  if (tx.value > 0n && toZero) risks.push(BURN_TO_ZERO_ADDRESS_RISK);
  if (tx.value > 0n && tx.to) {
    pushUnique(risks, [
      ...blocklistedSpenderRisks(tx.to, options?.lists),
      ...phishingSpenderRisks(tx.to, options?.phishingIndex),
    ]);
  }
  const simulation = emptySimulation();
  if (tx.value > 0n) simulation.notes.push(nativeValueNote(tx.value, tx.to));
  else simulation.notes.push('No value and no calldata: the transaction only consumes a nonce.');
  return {
    type: 'native_transfer',
    payload: {
      txType: tx.txType,
      chainId: tx.chainId != null ? tx.chainId.toString() : null,
      to: tx.to,
      value: tx.value.toString(),
      recipientKind: tx.to ? spenderKindFor(tx.to, options) : null,
      recipientLabel: labelFor(tx.to, options),
      isToZeroAddress: toZero,
    },
    risks,
    riskDetails: describeRisks(risks),
    severity: highestSeverity(risks),
    simulation,
  };
}

/**
 * Decode a raw tx's calldata and attach its native value: a note in the
 * simulation, plus a warning when the call is non-payable by standard.
 */
function rawTxReport(
  tx: ParsedRawTx,
  options?: ReportOptions
): JsonReport | null {
  if (tx.data === '0x') return nativeTransferReport(tx, options);
  const report = generateJsonReport(tx.data, options);
  if (!report || tx.value === 0n) return report;
  const risks = [...report.risks];
  pushUnique(risks, nativeValueCallRisks(report.type, tx.value));
  const notes = [...report.simulation.notes];
  pushUnique(notes, [nativeValueNote(tx.value, tx.to)]);
  return {
    ...report,
    risks,
    riskDetails: describeRisks(risks),
    severity: highestSeverity(risks),
    simulation: { ...report.simulation, notes },
  } as JsonReport;
}

function eip7702Report(
  decoded: Eip7702Decoded,
  options: ReportOptions | undefined,
  depth: number
): JsonReport {
  const risks: string[] = [];
  const simulation = emptySimulation();
  if (hasEip7702Delegation(decoded)) {
    pushUnique(risks, [EIP7702_DELEGATION_RISK]);
  }
  if (hasEip7702BroadDelegate(decoded)) {
    pushUnique(risks, [EIP7702_BROAD_DELEGATE_RISK]);
  }
  for (const item of decoded.authorizations) {
    if (item.isRevocation) continue;
    pushUnique(
      risks,
      approvalGrantRisks(item.address, true, options)
    );
  }
  let innerReport: JsonReport | null = null;
  if (decoded.data !== '0x' && depth + 1 < MAX_MULTICALL_DEPTH) {
    try {
      innerReport = generateJsonReportAt(decoded.data, options, depth + 1);
    } catch {
      innerReport = null;
    }
  }
  if (innerReport) {
    pushUnique(risks, innerReport.risks);
    pushUnique(risks, nativeValueCallRisks(innerReport.type, decoded.value));
    mergeSimulation(simulation, innerReport.simulation);
  }
  if (decoded.value > 0n) {
    pushUnique(simulation.notes, [nativeValueNote(decoded.value, decoded.to)]);
  }
  pushUnique(simulation.notes, [
    'EIP-7702 sets the sender EOA code to the designated contract until a later type-4 transaction clears it.',
  ]);
  return {
    type: 'eip7702',
    payload: {
      chainId: decoded.chainId.toString(),
      nonce: decoded.nonce.toString(),
      to: decoded.to,
      value: decoded.value.toString(),
      data: decoded.data,
      authorizations: decoded.authorizations.map((item) => ({
        chainId: item.chainId.toString(),
        address: item.address,
        nonce: item.nonce.toString(),
        yParity: item.yParity.toString(),
        r: item.r,
        s: item.s,
        isAnyChain: item.isAnyChain,
        isRevocation: item.isRevocation,
        delegateKind: spenderKindFor(item.address, options),
        delegateLabel: labelFor(item.address, options),
      })),
      innerReport,
    },
    risks,
    riskDetails: describeRisks(risks),
    severity: highestSeverity(risks),
    simulation,
  };
}

/**
 * Decode EVM calldata into a report. Batches (`multicall`, Multicall3
 * `aggregate*`) and Safe `execTransaction` envelopes are split and every
 * inner call is analyzed with the same rules, up to `MAX_MULTICALL_DEPTH`
 * levels of nesting.
 */
export function generateJsonReport(
  data: string,
  options?: ReportOptions
): JsonReport | null {
  return generateJsonReportAt(data, options, 0);
}

function generateJsonReportAt(
  data: string,
  options: ReportOptions | undefined,
  depth: number
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
        spenderLabel: labelFor(approve.spender, options),
      },
      ...reportMeta(risks, data, options),
    };
  }

  // A permit is an approve signed off-chain, so it gets the same spender
  // checks. Anyone holding the signature can submit it, not just the owner.
  const permit = decodeErc20Permit(data);
  if (permit) {
    return {
      type: 'erc20_permit',
      payload: {
        variant: permit.variant,
        owner: permit.owner,
        spender: permit.spender,
        value: permit.value.toString(),
        deadline: permit.deadline.toString(),
        nonce: permit.nonce != null ? permit.nonce.toString() : null,
        allowed: permit.allowed,
        isUnlimitedPermit: permit.isUnlimitedPermit,
        hasNoExpiry: permit.hasNoExpiry,
        spenderKind: spenderKindFor(permit.spender, options),
        spenderLabel: labelFor(permit.spender, options),
      },
      ...reportMeta(
        [
          ...unlimitedPermitRisks(permit),
          ...approvalGrantRisks(permit.spender, permit.value > 0n, options),
        ],
        data,
        options
      ),
    };
  }

  const permit2 = decodePermit2(data);
  if (permit2) {
    return {
      type: 'permit2',
      payload: permit2Payload(permit2, options),
      ...reportMeta(permit2Risks(permit2, options), data, options),
    };
  }

  const batch = decodeMulticall(data);
  if (batch) {
    return multicallReport(batch, options, depth);
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
        toLabel: labelFor(transfer.to, options),
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
        spenderLabel: labelFor(inc.spender, options),
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
        spenderLabel: labelFor(dec.spender, options),
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
        operatorLabel: labelFor(nft.operator, options),
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

  const handleOps = decodeHandleOps(data);
  if (handleOps) {
    return userOpReport(handleOps, options, depth);
  }

  const safe = decodeSafeExec(data);
  if (safe) {
    return safeExecReport(safe, options, depth);
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
  const splTokenInstructions = detectSplTokenInstructions(skeleton);
  const suspiciousCpi = detectSuspiciousCpi(
    skeleton,
    options?.suspiciousPrograms
  );
  const risks = [
    ...associatedTokenAccountRisks(associatedTokenAccounts),
    ...splTokenRisks(splTokenInstructions),
    ...suspiciousCpiRisks(suspiciousCpi),
  ];
  return {
    type: 'solana_tx',
    payload: {
      ...skeleton,
      associatedTokenAccounts,
      splTokenInstructions,
      suspiciousCpi,
    },
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

/** One plain-text line describing a decoded SPL Token instruction. */
export function formatSplTokenLine(ix: SolanaSplInstruction): string {
  const program = ix.isToken2022 ? 'token-2022' : 'token';
  const prefix = `SPL [${ix.instructionIndex}] ${ix.kind} (${program})`;
  if (ix.kind === 'transfer' || ix.kind === 'transfer_checked') {
    const amount =
      ix.decimals == null
        ? (ix.amount ?? '?')
        : `${ix.amount ?? '?'} (${ix.decimals} decimals)`;
    const mint = ix.mint ? ` mint=${ix.mint}` : '';
    return `${prefix}: ${amount} from ${ix.source ?? 'unknown'} to ${ix.destination ?? 'unknown'} owner=${ix.owner ?? 'unknown'}${mint}`;
  }
  const next = ix.isAuthorityRevoked
    ? 'revoked'
    : `new=${ix.newAuthority ?? 'unknown'}`;
  return `${prefix} ${ix.authorityType ?? 'other'}: account=${ix.account ?? 'unknown'} current=${ix.currentAuthority ?? 'unknown'} ${next}`;
}

/** One plain-text line describing a suspicious Solana CPI hit. */
export function formatCpiLine(hit: SolanaCpiHit): string {
  const role = hit.role === 'invoked' ? 'invoked' : 'cpi-target';
  return `CPI [${hit.instructionIndex}] ${role} ${hit.label} (${hit.category}): ${hit.programId}`;
}

function describeInnerReport(report: JsonReport | null): string {
  if (!report) return 'unrecognized';
  return report.risks.length > 0
    ? `${report.type} [${report.severity}: ${report.risks.join(', ')}]`
    : report.type;
}

/** One line per inner call, indented for nested batches. */
export function formatMulticallCallLines(
  calls: readonly MulticallCallReport[],
  indent: string
): string[] {
  const lines: string[] = [];
  for (const call of calls) {
    const parts = [`Call [${call.index}]`];
    if (call.target) parts.push(`target=${call.target}`);
    if (call.value != null && call.value !== '0') parts.push(`value=${call.value}`);
    if (call.allowFailure) parts.push('allowFailure');
    const what = call.depthLimited
      ? 'nested batch not analyzed (depth limit)'
      : describeInnerReport(call.report);
    lines.push(`${indent}${parts.join(' ')}: ${what}`);
    if (call.report?.type === 'multicall') {
      lines.push(...formatMulticallCallLines(call.report.payload.calls, `${indent}  `));
    }
  }
  return lines;
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
    case 'erc20_permit':
    case 'erc20_increaseAllowance':
    case 'erc20_decreaseAllowance': {
      lines.push(`Spender kind: ${report.payload.spenderKind}`);
      const spender = formatAddressLabel(report.payload.spenderLabel);
      if (spender) lines.push(`Spender label: ${spender}`);
      break;
    }
    case 'permit2': {
      if (report.payload.spenderKind) {
        lines.push(`Spender kind: ${report.payload.spenderKind}`);
      }
      const spender = formatAddressLabel(report.payload.spenderLabel);
      if (spender) lines.push(`Spender label: ${spender}`);
      const to = formatAddressLabel(report.payload.toLabel);
      if (to) lines.push(`Recipient label: ${to}`);
      break;
    }
    case 'nft_setApprovalForAll': {
      lines.push(`Operator kind: ${report.payload.operatorKind}`);
      const operator = formatAddressLabel(report.payload.operatorLabel);
      if (operator) lines.push(`Operator label: ${operator}`);
      break;
    }
    case 'erc20_transfer': {
      const to = formatAddressLabel(report.payload.toLabel);
      if (to) lines.push(`Recipient label: ${to}`);
      break;
    }
    case 'native_transfer': {
      const named = formatAddressLabel(report.payload.recipientLabel);
      if (named) lines.push(`Recipient label: ${named}`);
      break;
    }
    case 'multicall':
      lines.push(...formatMulticallCallLines(report.payload.calls, ''));
      break;
    case 'eip7702':
      lines.push(`Authorizations: ${report.payload.authorizations.length}`);
      for (const [index, item] of report.payload.authorizations.entries()) {
        const kind = item.isRevocation
          ? 'revoke'
          : item.isAnyChain
            ? 'any-chain'
            : `chain ${item.chainId}`;
        const named = formatAddressLabel(item.delegateLabel);
        lines.push(
          `Delegate [${index}] ${item.address} (${kind}, ${item.delegateKind}${named ? `, ${named}` : ''})`
        );
      }
      break;
    case 'erc4337_userop':
      lines.push(`EntryPoint: ${report.payload.version}`);
      lines.push(`User operations: ${report.payload.ops.length}`);
      for (const [opIndex, op] of report.payload.ops.entries()) {
        lines.push(
          `Op [${opIndex}] sender=${op.sender} paymaster=${op.paymaster ?? 'none'}`
        );
        for (const [callIndex, call] of op.calls.entries()) {
          const target = call.target ?? 'callData';
          lines.push(
            `  Call [${callIndex}] target=${target} value=${call.value}: ${describeInnerReport(call.report)}`
          );
        }
      }
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
      for (const spl of report.payload.splTokenInstructions) {
        lines.push(formatSplTokenLine(spl));
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
  if (report.liveCall) {
    lines.push(formatLiveCallLine(report.liveCall));
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
      const type4 = parseEip7702(input);
      if (type4) {
        return eip7702Report(type4, reportOptions, 0);
      }
    } catch {
      // Malformed type-4 bytes fall through like other typed prefixes.
    }
    try {
      const unwrapped = extractDataAndChainIdFromRawTx(input);
      if (unwrapped) {
        return rawTxReport(unwrapped, reportOptions);
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

