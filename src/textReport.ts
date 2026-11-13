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
