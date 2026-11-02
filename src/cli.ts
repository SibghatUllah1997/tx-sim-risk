#!/usr/bin/env node

import {
  decodeErc20Approve,
  decodeErc20Transfer,
  decodeErc20IncreaseAllowance,
  decodeErc20DecreaseAllowance,
} from './index';
import { parseEip1559Fees } from './evm/eip1559';
import { extractDataAndChainIdFromRawTx } from './evm/rawtx';

function printUsage(): void {
  console.error('Usage: tx-sim-risk <hexData> | --data <hexData>');
  console.error('Example: tx-sim-risk 0x095ea7b3....');
}

function isHexStringLike(input: string | undefined): input is string {
  return !!input && input.trim().toLowerCase().startsWith('0x');
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
    if (arg === '--json') continue; // ignore flag when scanning for data
    if (isHexStringLike(arg)) {
      dataArg = arg;
      break;
    }
  }

  if (isHexStringLike(dataArg)) {
    return dataArg!;
  }

  if (!process.stdin.isTTY) {
    const fromStdin = (await readStdin()).trim();
    if (isHexStringLike(fromStdin)) {
      return fromStdin;
    }
  }

  return null;
}

async function main() {
  const argv = process.argv.slice(2);
  const data = await getHexFromArgsOrStdin(argv);
  const wantJson = hasJsonFlag(argv);
  const wantFees = hasFeesFlag(argv);
  const wantChainId = hasChainIdFlag(argv);
  if (!isHexStringLike(data)) {
    printUsage();
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

    // Unwrap hardware-wallet style raw tx to extract calldata for decoding
    const unwrapped = extractDataAndChainIdFromRawTx(data);
    const effectiveData = unwrapped ? unwrapped.data : data;

    if (wantJson) {
      const { generateJsonReport } = await import('./report');
      const report = generateJsonReport(effectiveData);
      if (report) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.log(JSON.stringify({ type: 'unknown', risks: [], payload: {} }, null, 2));
      }
      process.exit(0);
      return;
    }

    if (wantChainId) {
      const parsed = extractDataAndChainIdFromRawTx(data);
      if (parsed && parsed.chainId != null) {
        console.log(`Chain ID: ${parsed.chainId.toString()}`);
      } else {
        console.log('Chain ID: unknown');
      }
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
      process.exit(0);
      return;
    }

    const inc = decodeErc20IncreaseAllowance(effectiveData);
    if (inc) {
      console.log('Detected: ERC-20 increaseAllowance(address,uint256)');
      console.log(`Spender: ${inc.spender}`);
      console.log(`Delta: +${inc.amountDelta.toString()}`);
      process.exit(0);
      return;
    }

    const dec = decodeErc20DecreaseAllowance(effectiveData);
    if (dec) {
      console.log('Detected: ERC-20 decreaseAllowance(address,uint256)');
      console.log(`Spender: ${dec.spender}`);
      console.log(`Delta: -${dec.amountDelta.toString()}`);
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

