#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import {
  CLI_USAGE_LINES,
  hasFlag,
  isReservedArg,
  reportOptionsFromArgv,
} from './cliOptions';
import { classifyCliInput, isPayloadLike } from './payload';
import { formatPackageIdentity } from './packageInfo';
import { defaultReportSchemaPath } from './schema';
import {
  generateJsonReportFromAny,
  type ReportOptions,
} from './report';
import { renderHtmlReport } from './html';
import {
  formatChainIdLine,
  formatFeeAnalysis,
  formatPlainTextAnalysis,
} from './textReport';

function printUsage(stream: NodeJS.WritableStream = process.stderr): void {
  stream.write(`${CLI_USAGE_LINES.join('\n')}\n`);
}

async function readStdin(): Promise<string> {
  return await new Promise<string>((resolve) => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (buf += chunk));
    process.stdin.on('end', () => resolve(buf.trim()));
  });
}

function printReportSchema(): void {
  process.stdout.write(readFileSync(defaultReportSchemaPath(), 'utf8'));
}

function payloadFromToken(token: string): string {
  const classified = classifyCliInput(token);
  if (classified.kind === 'invalid-hex') {
    throw new Error('input is not valid hex');
  }
  if (classified.kind === 'hex' || classified.kind === 'base64') {
    return classified.value;
  }
  throw new Error(
    'input is not hex calldata, a raw transaction, or a Solana tx'
  );
}

function tryPayloadFromToken(token: string | null | undefined): string | null {
  const classified = classifyCliInput(token);
  if (classified.kind === 'invalid-hex') {
    throw new Error('input is not valid hex');
  }
  if (classified.kind === 'hex' || classified.kind === 'base64') {
    return classified.value;
  }
  return null;
}

async function getHexFromArgsOrStdin(argv: string[]): Promise<string | null> {
  let dataArg: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--data' && argv[i + 1]) {
      dataArg = argv[i + 1];
      break;
    }
    if (arg.startsWith('--data=')) {
      dataArg = arg.slice('--data='.length);
      break;
    }
    if (isReservedArg(argv, i)) continue;
    const payload = tryPayloadFromToken(arg);
    if (payload) {
      dataArg = payload;
      break;
    }
  }

  if (dataArg != null) {
    return payloadFromToken(dataArg);
  }

  if (!process.stdin.isTTY) {
    const fromStdin = (await readStdin()).trim();
    return tryPayloadFromToken(fromStdin);
  }

  return null;
}

function printLines(lines: readonly string[]): void {
  for (const line of lines) {
    console.log(line);
  }
}

async function main() {
  const argv = process.argv.slice(2);
  if (hasFlag(argv, ['--help', '-h'])) {
    printUsage(process.stdout);
    process.exit(0);
    return;
  }
  if (hasFlag(argv, ['--version', '-V'])) {
    console.log(formatPackageIdentity());
    process.exit(0);
    return;
  }
  if (hasFlag(argv, ['--schema'])) {
    printReportSchema();
    process.exit(0);
    return;
  }
  let data: string | null;
  try {
    data = await getHexFromArgsOrStdin(argv);
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
    return;
  }
  const wantJson = hasFlag(argv, ['--json']);
  const wantHtml = hasFlag(argv, ['--html']);
  const wantFees = hasFlag(argv, ['--fees']);
  const wantChainId = hasFlag(argv, ['--chainId', '--chainid']);
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
      printLines(formatFeeAnalysis(data, wantChainId));
      process.exit(0);
      return;
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
      console.log(formatChainIdLine(data));
    }

    const lines = formatPlainTextAnalysis(data, reportOptions);
    if (lines) {
      printLines(lines);
    } else {
      console.log('Unsupported or unknown transaction data for current decoders.');
    }
    process.exit(0);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Unknown error during analysis';
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}

main();
