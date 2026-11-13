import { loadAddressLists } from './config';
import type { ReportOptions } from './report';

/** Help text printed by `--help` (stdout) and by a missing-payload error (stderr). */
export const CLI_USAGE_LINES = [
  'Usage: tx-sim-risk <hexData | solanaTx> | --data <payload> [options]',
  '       tx-sim-risk --schema',
  '       tx-sim-risk --version',
  '       tx-sim-risk --help',
  '',
  'Options:',
  '  --data <payload>   Hex calldata, raw EVM tx, or Solana tx (also positional)',
  '  --json             Print a JSON report',
  '  --html             Print a standalone HTML report',
  '  --from <addr>      Sender address used in simulation deltas',
  '  --config <file>    Allow/block list JSON',
  '  --fees             Parse EIP-1559 fee fields from a raw tx',
  '  --chainId          Print the EIP-155 chain id from a raw tx',
  '  --schema           Print the JSON Schema for --json reports',
  '  --version          Print the package version',
  '  --help             Show this help',
  '',
  'Example: tx-sim-risk 0x095ea7b3....',
];

/** Flags that stand alone (no following value). */
export const BOOLEAN_FLAGS = [
  '--json',
  '--html',
  '--fees',
  '--solana',
  '--schema',
  '--chainId',
  '--chainid',
  '--help',
  '-h',
  '--version',
  '-V',
] as const;

/** Flags whose next argv token is a value, not a payload. */
export const VALUE_FLAGS = ['--data', '--from', '--config'] as const;

/**
 * True when argv contains one of `names` as a bare token. `--name=value`
 * forms are ignored; use {@link flagValue} for those.
 */
export function hasFlag(
  argv: readonly string[],
  names: readonly string[]
): boolean {
  const exact = new Set(names);
  return argv.some((arg) => exact.has(arg));
}

/**
 * Read `--name value` or `--name=value` from argv. The last occurrence wins.
 * A bare flag with no following token is ignored.
 */
export function flagValue(
  argv: readonly string[],
  names: readonly string[]
): string | undefined {
  const exact = new Set(names);
  let found: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    for (const name of names) {
      if (arg.startsWith(`${name}=`)) {
        found = arg.slice(name.length + 1);
      }
    }
    if (exact.has(arg) && argv[i + 1] !== undefined) {
      found = argv[i + 1];
      i++;
    }
  }
  return found;
}

/**
 * True when `arg` is a known flag or the value of a known `--name value`
 * pair, so it must not be treated as calldata.
 */
export function isReservedArg(
  argv: readonly string[],
  index: number
): boolean {
  const arg = argv[index];
  if (arg == null) return false;
  if ((BOOLEAN_FLAGS as readonly string[]).includes(arg)) return true;
  for (const name of VALUE_FLAGS) {
    if (arg === name || arg.startsWith(`${name}=`)) return true;
  }
  if (index > 0) {
    const prev = argv[index - 1];
    if (prev != null && (VALUE_FLAGS as readonly string[]).includes(prev)) {
      return true;
    }
  }
  return false;
}

/**
 * Build report options from `--from` and `--config`. Throws if `--config`
 * points at a missing or invalid file. Returns undefined when neither flag
 * is present, so callers can skip allocating an options object.
 */
export function reportOptionsFromArgv(
  argv: readonly string[]
): ReportOptions | undefined {
  const from = flagValue(argv, ['--from']);
  const configPath = flagValue(argv, ['--config']);
  const lists = configPath ? loadAddressLists(configPath) : undefined;
  if (!from && !lists) return undefined;
  const options: ReportOptions = {};
  if (from) options.from = from;
  if (lists) options.lists = lists;
  return options;
}
