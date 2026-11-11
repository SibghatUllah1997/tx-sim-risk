#!/usr/bin/env node

import {
  decodeErc20Approve,
  decodeErc20Transfer,
  decodeErc20IncreaseAllowance,
  decodeErc20DecreaseAllowance,
  decodeErc721SetApprovalForAll,
  decodeErc1155SetApprovalForAll,
  decodeCommonAbi,
  parseSolanaTxSkeleton,
  type AbiArgValue,
} from './index';
import { parseEip1559Fees } from './evm/eip1559';
import {
  formatReportFooter,
  generateJsonReport,
  generateJsonReportFromAny,
  type ReportOptions,
} from './report';
import { renderHtmlReport } from './html';
import { extractDataAndChainIdFromRawTx } from './evm/rawtx';
import { isHexString } from './evm/hex';
import { reportOptionsFromArgv } from './cliOptions';
import type { SolanaTxSkeleton } from './solana/skeleton';

function printReportFooter(data: string, options?: ReportOptions): void {
  const report = generateJsonReport(data, options);
  if (!report) return;
  for (const line of formatReportFooter(report)) {
    console.log(line);
  }
}

function formatAbiValue(value: AbiArgValue): string {
  return Array.isArray(value)
    ? `[${value.map(formatAbiValue).join(', ')}]`
    : String(value);
}

function printUsage(): void {
  console.error(
    'Usage: tx-sim-risk <hexData | solanaTx> | --data <payload> [--json | --html] [--from <addr>] [--config <lists.json>]'
  );
  console.error('Example: tx-sim-risk 0x095ea7b3....');
}

function isHexStringLike(input: string | null | undefined): input is string {
  return !!input && input.trim().toLowerCase().startsWith('0x');
}

function isBase64Payload(input: string | null | undefined): input is string {
  if (!input) return false;
  const trimmed = input.trim();
  return (
    trimmed.length >= 64 && /^[A-Za-z0-9+/]+={0,2}$/.test(trimmed)
  );
}

function isPayloadLike(input: string | null | undefined): input is string {
  return isHexStringLike(input) || isBase64Payload(input);
}

function printSolanaSkeleton(skeleton: SolanaTxSkeleton): void {
  console.log(`Detected: Solana transaction (${skeleton.version})`);
  console.log(`Fee payer: ${skeleton.feePayer ?? 'unknown'}`);
  console.log(`Recent blockhash: ${skeleton.recentBlockhash}`);
  console.log(`Signatures: ${skeleton.signatures.length}`);
  console.log(`Account keys: ${skeleton.accountKeys.length}`);
  console.log(`Instructions: ${skeleton.instructions.length}`);
  skeleton.instructions.forEach((ix, index) => {
    console.log(
      `  [${index}] program=${ix.programId} accounts=${ix.accounts.length} data=${ix.dataHex}`
    );
  });
}

async function readStdin(): Promise<string> {
  return await new Promise<string>((resolve) => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (buf += chunk));
    process.stdin.on('end', () => resolve(buf.trim()));
  });
}

function hasJsonFlag(argv: string[]): boolean {
  return argv.includes('--json');
}

function hasHtmlFlag(argv: string[]): boolean {
  return argv.includes('--html');
}

function hasFeesFlag(argv: string[]): boolean {
  return argv.includes('--fees');
}

function hasChainIdFlag(argv: string[]): boolean {
  return argv.includes('--chainId') || argv.includes('--chainid');
}

async function getHexFromArgsOrStdin(argv: string[]): Promise<string | null> {
  let dataArg: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--data' && argv[i + 1]) {
      dataArg = argv[i + 1];
      break;
    }
    if (arg.startsWith('--data=')) {
      dataArg = arg.slice('--data='.length);
      break;
    }
    if (
      arg === '--json' ||
      arg === '--html' ||
      arg === '--fees' ||
      arg === '--solana'
    )
      continue;
    if (arg === '--chainId' || arg === '--chainid') continue;
    if (arg === '--from') {
      i++; // skip the address value so it is not treated as calldata
      continue;
    }
    if (arg.startsWith('--from=')) continue;
    if (arg === '--config') {
      i++; // skip the path value so it is not treated as calldata
      continue;
    }
    if (arg.startsWith('--config=')) continue;
    if (isPayloadLike(arg)) {
      dataArg = arg;
      break;
    }
  }

  if (isPayloadLike(dataArg)) {
    return dataArg!;
  }

  if (!process.stdin.isTTY) {
    const fromStdin = (await readStdin()).trim();
    if (isPayloadLike(fromStdin)) {
      return fromStdin;
    }
  }

  return null;
}

async function main() {
  const argv = process.argv.slice(2);
  const data = await getHexFromArgsOrStdin(argv);
  const wantJson = hasJsonFlag(argv);
  const wantHtml = hasHtmlFlag(argv);
  const wantFees = hasFeesFlag(argv);
  const wantChainId = hasChainIdFlag(argv);
  if (!isPayloadLike(data)) {
    printUsage();
    process.exit(1);
    return;
  }

  let reportOptions: ReportOptions | undefined;
  try {
    reportOptions = reportOptionsFromArgv(argv);
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
    return;
  }

  try {
    if (wantFees) {
      const fees = parseEip1559Fees(data);
      if (fees) {
        console.log('Detected: EIP-1559 raw transaction');
        console.log(`Gas limit: ${fees.gasLimit.toString()}`);
        console.log(
          `Max priority fee per gas: ${fees.maxPriorityFeePerGas.toString()} wei`
        );
        console.log(`Max fee per gas: ${fees.maxFeePerGas.toString()} wei`);
        if (wantChainId) {
          const parsed = extractDataAndChainIdFromRawTx(data);
          if (parsed && parsed.txType === 'eip1559') {
            console.log(`Chain ID: ${parsed.chainId.toString()}`);
          } else {
            console.log('Chain ID: unknown');
          }
        }
      } else {
        console.log('No EIP-1559 fee fields found in input.');
        if (wantChainId) {
          const parsed = extractDataAndChainIdFromRawTx(data);
          if (parsed && parsed.chainId != null) {
            console.log(`Chain ID: ${parsed.chainId.toString()}`);
          } else {
            console.log('Chain ID: unknown');
          }
        }
      }
      process.exit(0);
      return;
    }

    // Unwrap hardware-wallet style raw tx to extract calldata for decoding.
    // A typed-prefix blob that is not EVM (for example a Solana tx) must
    // not abort the rest of the pipeline.
    let effectiveData = data;
    try {
      const unwrapped = extractDataAndChainIdFromRawTx(data);
      if (unwrapped) effectiveData = unwrapped.data;
    } catch {
      effectiveData = data;
    }

    if (wantHtml) {
      const report = generateJsonReportFromAny(data, reportOptions);
      if (!report) {
        console.error('Error: no supported call found; cannot build an HTML report.');
        process.exit(1);
        return;
      }
      process.stdout.write(renderHtmlReport(report));
      process.exit(0);
      return;
    }

    if (wantJson) {
      const report = generateJsonReportFromAny(data, reportOptions);
      if (report) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.log(JSON.stringify({ type: 'unknown', risks: [], payload: {} }, null, 2));
      }
      process.exit(0);
      return;
    }

    if (wantChainId) {
      try {
        const parsed = extractDataAndChainIdFromRawTx(data);
        if (parsed && parsed.chainId != null) {
          console.log(`Chain ID: ${parsed.chainId.toString()}`);
        } else {
          console.log('Chain ID: unknown');
        }
      } catch {
        console.log('Chain ID: unknown');
      }
    }

    if (!isHexString(effectiveData)) {
      const solana = parseSolanaTxSkeleton(data);
      if (solana) {
        printSolanaSkeleton(solana);
        const report = generateJsonReportFromAny(data, reportOptions);
        if (report) {
          for (const line of formatReportFooter(report)) {
            console.log(line);
          }
        }
        process.exit(0);
        return;
      }
      console.log('Unsupported or unknown transaction data for current decoders.');
      process.exit(0);
      return;
    }

    const approve = decodeErc20Approve(effectiveData);
    if (approve) {
      // Plain-text analysis output (JSON report arrives later in roadmap)
      console.log('Detected: ERC-20 approve(address,uint256)');
      console.log(`Spender: ${approve.spender}`);
      console.log(`Amount: ${approve.amount.toString()}`);
      console.log(
        `Unlimited approval: ${approve.isUnlimitedApproval ? 'yes' : 'no'}`
      );
      printReportFooter(effectiveData, reportOptions);
      process.exit(0);
      return;
    }

    const transfer = decodeErc20Transfer(effectiveData);
    if (transfer) {
      console.log('Detected: ERC-20 transfer(address,uint256)');
      console.log(`To: ${transfer.to}`);
      console.log(`Amount: ${transfer.amount.toString()}`);
      console.log(
        `Burn address: ${transfer.isToZeroAddress ? 'yes' : 'no'}`
      );
      printReportFooter(effectiveData, reportOptions);
      process.exit(0);
      return;
    }

    const inc = decodeErc20IncreaseAllowance(effectiveData);
    if (inc) {
      console.log('Detected: ERC-20 increaseAllowance(address,uint256)');
      console.log(`Spender: ${inc.spender}`);
      console.log(`Delta: +${inc.amountDelta.toString()}`);
      printReportFooter(effectiveData, reportOptions);
      process.exit(0);
      return;
    }

    const dec = decodeErc20DecreaseAllowance(effectiveData);
    if (dec) {
      console.log('Detected: ERC-20 decreaseAllowance(address,uint256)');
      console.log(`Spender: ${dec.spender}`);
      console.log(`Delta: -${dec.amountDelta.toString()}`);
      printReportFooter(effectiveData, reportOptions);
      process.exit(0);
      return;
    }

    const nft721 = decodeErc721SetApprovalForAll(effectiveData);
    if (nft721) {
      const nft1155 = decodeErc1155SetApprovalForAll(effectiveData);
      console.log(
        'Detected: setApprovalForAll(address,bool) [ERC-721 / ERC-1155]'
      );
      console.log(`Operator: ${nft721.operator}`);
      console.log(`Approved: ${nft721.approved ? 'yes' : 'no'}`);
      console.log(
        `ERC-721 approve-all: ${nft721.isApproveAll ? 'yes' : 'no'}`
      );
      console.log(
        `ERC-1155 approve-all: ${nft1155?.isApproveAll ? 'yes' : 'no'}`
      );
      printReportFooter(effectiveData, reportOptions);
      process.exit(0);
      return;
    }

    const generic = decodeCommonAbi(effectiveData);
    if (generic) {
      console.log(`Detected: ${generic.signature} [via ABI]`);
      for (const arg of generic.args) {
        console.log(`${arg.name} (${arg.type}): ${formatAbiValue(arg.value)}`);
      }
      printReportFooter(effectiveData, reportOptions);
      process.exit(0);
      return;
    }

    const solana = parseSolanaTxSkeleton(data);
    if (solana) {
      printSolanaSkeleton(solana);
      const report = generateJsonReportFromAny(data, reportOptions);
      if (report) {
        for (const line of formatReportFooter(report)) {
          console.log(line);
        }
      }
      process.exit(0);
      return;
    }

    const viaPlugin = generateJsonReportFromAny(data, reportOptions);
    if (viaPlugin?.type === 'plugin_decode') {
      console.log(
        `Detected: ${viaPlugin.payload.chain} via plugin ${viaPlugin.payload.pluginId}`
      );
      console.log(`Summary: ${viaPlugin.payload.summary}`);
      for (const line of formatReportFooter(viaPlugin)) {
        console.log(line);
      }
      process.exit(0);
      return;
    }

    console.log('Unsupported or unknown transaction data for current decoders.');
    process.exit(0);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Unknown error during analysis';
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}

main();

