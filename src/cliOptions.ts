import { loadAddressLists } from './config';
import type { ReportOptions } from './report';

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
