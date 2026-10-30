#!/usr/bin/env node

import { decodeErc20Approve, decodeErc20Transfer } from './index';

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
  if (!isHexStringLike(data)) {
    printUsage();
    process.exit(1);
    return;
  }

  try {
    const approve = decodeErc20Approve(data);
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

    const transfer = decodeErc20Transfer(data);
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

