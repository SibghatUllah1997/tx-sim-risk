import type { AbiArgValue } from './evm/abi';
import { parseEip1559Fees } from './evm/eip1559';
import { extractDataAndChainIdFromRawTx } from './evm/rawtx';
import {
  formatReportFooter,
  generateJsonReportFromAny,
  type JsonReport,
  type ReportOptions,
} from './report';

function formatAbiValue(value: AbiArgValue): string {
  return Array.isArray(value)
    ? `[${value.map(formatAbiValue).join(', ')}]`
    : String(value);
}

/**
 * "Detected:" header lines for a decoded report. These match the CLI
 * text output so screenshots, unit tests, and `tx-sim-risk` stay in sync.
 */
export function formatDetectedHeader(report: JsonReport): string[] {
  switch (report.type) {
    case 'erc20_approve':
      return [
        'Detected: ERC-20 approve(address,uint256)',
        `Spender: ${report.payload.spender}`,
        `Amount: ${report.payload.amount}`,
        `Unlimited approval: ${report.payload.isUnlimitedApproval ? 'yes' : 'no'}`,
      ];
    case 'erc20_permit': {
      const p = report.payload;
      const lines = [
        `Detected: ERC-20 ${p.variant === 'dai' ? 'DAI-style ' : 'EIP-2612 '}permit`,
        `Owner: ${p.owner}`,
        `Spender: ${p.spender}`,
        `Value: ${p.value}`,
        `${p.variant === 'dai' ? 'Expiry' : 'Deadline'}: ${p.deadline}${p.hasNoExpiry ? ' (never expires)' : ''}`,
      ];
      if (p.nonce != null) lines.push(`Nonce: ${p.nonce}`);
      if (p.allowed != null) lines.push(`Allowed: ${p.allowed ? 'yes' : 'no'}`);
      lines.push(`Unlimited permit: ${p.isUnlimitedPermit ? 'yes' : 'no'}`);
      return lines;
    }
    case 'permit2': {
      const p = report.payload;
      const labels: Record<typeof p.variant, string> = {
        approve: 'Permit2 approve',
        permit: 'Permit2 permit',
        permit_batch: 'Permit2 permit (batch)',
        permit_transfer_from: 'Permit2 permitTransferFrom',
      };
      const lines = [`Detected: ${labels[p.variant]}`, `Token: ${p.token}`];
      if (p.owner) lines.push(`Owner: ${p.owner}`);
      if (p.spender) lines.push(`Spender: ${p.spender}`);
      if (p.to) lines.push(`To: ${p.to}`);
      lines.push(`Amount: ${p.amount}`);
      if (p.requestedAmount != null) {
        lines.push(`Requested amount: ${p.requestedAmount}`);
      }
      if (p.expiration != null) lines.push(`Expiration: ${p.expiration}`);
      if (p.deadline != null) lines.push(`Deadline: ${p.deadline}`);
      if (p.nonce != null) lines.push(`Nonce: ${p.nonce}`);
      if (p.variant === 'permit_batch') {
        lines.push(`Entries: ${p.allowances.length}`);
      }
      lines.push(`Never expires: ${p.hasNoExpiry ? 'yes' : 'no'}`);
      lines.push(`Unlimited: ${p.isUnlimited ? 'yes' : 'no'}`);
      return lines;
    }
    case 'eip7702': {
      const p = report.payload;
      const lines = [
        'Detected: EIP-7702 type-4 transaction',
        `Chain ID: ${p.chainId}`,
        `Authorizations: ${p.authorizations.length}`,
      ];
      if (p.to) lines.push(`To: ${p.to}`);
      if (p.value !== '0') lines.push(`Value: ${p.value}`);
      p.authorizations.forEach((item, index) => {
        const scope = item.isRevocation
          ? 'revoke'
          : item.isAnyChain
            ? 'any-chain'
            : `chain ${item.chainId}`;
        lines.push(
          `  [${index}] delegate=${item.address} ${scope}`
        );
      });
      return lines;
    }
    case 'safe_exec': {
      const p = report.payload;
      const lines = [
        `Detected: Safe ${p.signature}`,
        `To: ${p.to}`,
        `Operation: ${p.operation}`,
        `Value: ${p.value}`,
      ];
      if (p.innerReport) {
        lines.push(`Inner: ${p.innerReport.type}`);
      } else if (p.data === '0x') {
        lines.push('Inner: native transfer');
      } else if (p.depthLimited) {
        lines.push('Inner: not analyzed (depth limit)');
      }
      return lines;
    }
    case 'universal_router': {
      const p = report.payload;
      const lines = [
        `Detected: Uniswap Universal Router ${p.signature}`,
        `Commands: ${p.commands.length}`,
      ];
      if (p.deadline != null) lines.push(`Deadline: ${p.deadline}`);
      p.commands.forEach((command) => {
        const extra = command.allowRevert ? ' (allowRevert)' : '';
        lines.push(`  [${command.index}] ${command.kind}${extra}`);
      });
      return lines;
    }
    case 'cowswap': {
      const p = report.payload;
      if (p.variant === 'settle') {
        const lines = [
          `Detected: CowSwap ${p.signature}`,
          `Tokens: ${p.tokens.length}`,
          `Trades: ${p.trades.length}`,
        ];
        p.trades.forEach((item) => {
          const receiver = item.receiverIsOwner ? 'owner' : item.receiver;
          lines.push(
            `  trade [${item.index}] ${item.kind} ${item.signingScheme} receiver=${receiver}`
          );
        });
        lines.push(`Interactions: ${p.interactions.length}`);
        p.interactions.forEach((item) => {
          lines.push(
            `  interaction [${item.index}] ${item.stage} target=${item.target}`
          );
        });
        return lines;
      }
      const lines = [`Detected: CowSwap ${p.signature}`];
      if (p.orderUid) lines.push(`Order UID: ${p.orderUid}`);
      if (p.signed != null) lines.push(`Signed: ${p.signed ? 'yes' : 'no'}`);
      return lines;
    }
    case 'oneinch': {
      const p = report.payload;
      const lines = [`Detected: 1inch Aggregation Router ${p.signature}`];
      if (p.executor) lines.push(`Executor: ${p.executor}`);
      if (p.srcToken) {
        lines.push(
          `Src token: ${p.srcToken}${p.srcIsEth ? ' (native ETH)' : ''}`
        );
      }
      if (p.dstToken) {
        lines.push(
          `Dst token: ${p.dstToken}${p.dstIsEth ? ' (native ETH)' : ''}`
        );
      }
      if (p.amount != null) lines.push(`Amount: ${p.amount}`);
      if (p.minReturn != null) lines.push(`Min return: ${p.minReturn}`);
      if (p.dstReceiver) lines.push(`Dst receiver: ${p.dstReceiver}`);
      if (p.recipient) lines.push(`Recipient: ${p.recipient}`);
      if (p.clipperExchange) {
        lines.push(`Clipper exchange: ${p.clipperExchange}`);
      }
      if (p.pools.length > 0) lines.push(`Pools: ${p.pools.length}`);
      lines.push(`Permit: ${p.permit === '0x' ? 'none' : 'nested'}`);
      if (p.variant === 'swap') {
        lines.push(
          `Executor data: ${p.executorData === '0x' ? 'none' : 'nested'}`
        );
      }
      return lines;
    }
    case 'erc4337_userop': {
      const lines = [
        `Detected: ERC-4337 handleOps (${report.payload.version})`,
        `Ops: ${report.payload.ops.length}`,
        `Beneficiary: ${report.payload.beneficiary}`,
      ];
      report.payload.ops.forEach((op, opIndex) => {
        lines.push(
          `  [${opIndex}] sender=${op.sender} paymaster=${op.paymaster ?? 'none'}`
        );
        op.calls.forEach((call, callIndex) => {
          const target = call.target ?? 'callData';
          const inner = call.report?.type ?? 'unknown';
          const risks =
            call.report && call.report.risks.length > 0
              ? ` risks=${call.report.risks.join(',')}`
              : '';
          lines.push(
            `    call ${callIndex} target=${target} value=${call.value} type=${inner}${risks}`
          );
        });
      });
      return lines;
    }
    case 'multicall': {
      const p = report.payload;
      const lines = [`Detected: ${p.signature} batch`, `Calls: ${p.calls.length}`];
      if (p.deadline != null) lines.push(`Deadline: ${p.deadline}`);
      if (p.previousBlockhash != null) {
        lines.push(`Previous block hash: ${p.previousBlockhash}`);
      }
      if (p.totalValue !== '0') lines.push(`Total value: ${p.totalValue}`);
      lines.push(
        `Inner calls run as: ${p.forwardsAsContract ? 'Multicall3 contract' : 'original sender'}`
      );
      return lines;
    }
    case 'native_transfer': {
      const p = report.payload;
      return [
        `Detected: native ETH transfer (${p.txType} tx, no calldata)`,
        `Chain ID: ${p.chainId ?? 'unknown'}`,
        `To: ${p.to ?? 'contract creation'}`,
        `Value (wei): ${p.value}`,
        `Recipient kind: ${p.recipientKind ?? 'n/a'}`,
      ];
    }
    case 'erc20_transfer':
      return [
        'Detected: ERC-20 transfer(address,uint256)',
        `To: ${report.payload.to}`,
        `Amount: ${report.payload.amount}`,
        `Burn address: ${report.payload.isToZeroAddress ? 'yes' : 'no'}`,
      ];
    case 'erc20_increaseAllowance':
      return [
        'Detected: ERC-20 increaseAllowance(address,uint256)',
        `Spender: ${report.payload.spender}`,
        `Delta: +${report.payload.amountDelta}`,
      ];
    case 'erc20_decreaseAllowance':
      return [
        'Detected: ERC-20 decreaseAllowance(address,uint256)',
        `Spender: ${report.payload.spender}`,
        `Delta: -${report.payload.amountDelta}`,
      ];
    case 'nft_setApprovalForAll':
      return [
        'Detected: setApprovalForAll(address,bool) [ERC-721 / ERC-1155]',
        `Operator: ${report.payload.operator}`,
        `Approved: ${report.payload.approved ? 'yes' : 'no'}`,
        `ERC-721 approve-all: ${report.payload.isApproveAll ? 'yes' : 'no'}`,
        `ERC-1155 approve-all: ${report.payload.isApproveAll ? 'yes' : 'no'}`,
      ];
    case 'abi_call':
      return [
        `Detected: ${report.payload.signature} [via ABI]`,
        ...report.payload.args.map(
          (arg) => `${arg.name} (${arg.type}): ${formatAbiValue(arg.value)}`
        ),
      ];
    case 'solana_tx': {
      const skeleton = report.payload;
      const lines = [
        `Detected: Solana transaction (${skeleton.version})`,
        `Fee payer: ${skeleton.feePayer ?? 'unknown'}`,
        `Recent blockhash: ${skeleton.recentBlockhash}`,
        `Signatures: ${skeleton.signatures.length}`,
        `Account keys: ${skeleton.accountKeys.length}`,
        `Instructions: ${skeleton.instructions.length}`,
      ];
      skeleton.instructions.forEach((ix, index) => {
        lines.push(
          `  [${index}] program=${ix.programId} accounts=${ix.accounts.length} data=${ix.dataHex}`
        );
      });
      return lines;
    }
    case 'plugin_decode':
      return [
        `Detected: ${report.payload.chain} via plugin ${report.payload.pluginId}`,
        `Summary: ${report.payload.summary}`,
      ];
  }
}

/** CLI-style analysis lines for a decoded report (header plus footer). */
export function formatPlainTextReport(report: JsonReport): string[] {
  return [...formatDetectedHeader(report), ...formatReportFooter(report)];
}

/**
 * Decode `input` the same way the JSON path does, then format it as
 * plain text. Returns null when no decoder claims the bytes.
 */
export function formatPlainTextAnalysis(
  input: string,
  options?: ReportOptions
): string[] | null {
  const report = generateJsonReportFromAny(input, options);
  if (!report) return null;
  return formatPlainTextReport(report);
}

/** One `Chain ID: …` line, or `Chain ID: unknown` when it cannot be parsed. */
export function formatChainIdLine(raw: string): string {
  try {
    const parsed = extractDataAndChainIdFromRawTx(raw);
    if (parsed && parsed.chainId != null) {
      return `Chain ID: ${parsed.chainId.toString()}`;
    }
  } catch {
    // Malformed typed-prefix bytes are not a readable chain id.
  }
  return 'Chain ID: unknown';
}

/**
 * Plain-text `--fees` output. Throws on a malformed type-2 payload, matching
 * the previous CLI behaviour so e2e error tests stay stable.
 */
export function formatFeeAnalysis(
  raw: string,
  includeChainId: boolean
): string[] {
  const fees = parseEip1559Fees(raw);
  const lines: string[] = [];
  if (fees) {
    lines.push('Detected: EIP-1559 raw transaction');
    lines.push(`Gas limit: ${fees.gasLimit.toString()}`);
    lines.push(
      `Max priority fee per gas: ${fees.maxPriorityFeePerGas.toString()} wei`
    );
    lines.push(`Max fee per gas: ${fees.maxFeePerGas.toString()} wei`);
    if (includeChainId) {
      try {
        const parsed = extractDataAndChainIdFromRawTx(raw);
        if (parsed && parsed.txType === 'eip1559') {
          lines.push(`Chain ID: ${parsed.chainId.toString()}`);
        } else {
          lines.push('Chain ID: unknown');
        }
      } catch {
        lines.push('Chain ID: unknown');
      }
    }
    return lines;
  }
  lines.push('No EIP-1559 fee fields found in input.');
  if (includeChainId) {
    lines.push(formatChainIdLine(raw));
  }
  return lines;
}
