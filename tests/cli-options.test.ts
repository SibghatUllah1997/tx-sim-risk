import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BLOCKLISTED_SPENDER_RISK,
  isAllowlisted,
  isBlocklisted,
  loadAddressLists,
} from '../src';
import {
  CLI_USAGE_LINES,
  flagValue,
  hasFlag,
  isReservedArg,
  reportOptionsFromArgv,
} from '../src/cliOptions';
import { generateJsonReport } from '../src/report';

function word(hexNoPrefix: string): string {
  return hexNoPrefix.padStart(64, '0');
}

function approve(spenderNo0x: string, amountHex: string): string {
  return `0x095ea7b3${word(`000000000000000000000000${spenderNo0x}`)}${word(amountHex)}`;
}

const EXAMPLE_CONFIG = join(__dirname, '..', 'examples', 'risk-lists.json');
const BLOCKED = 'badc0ffee0000000000000000000000000000001';
const ROUTER = '7a250d5630b4cf539739df2c5dacb4c659f2488d';

describe('flagValue', () => {
  it('reads space-separated and equals forms; last occurrence wins', () => {
    expect(flagValue(['--config', 'a.json'], ['--config'])).toBe('a.json');
    expect(flagValue(['--config=b.json'], ['--config'])).toBe('b.json');
    expect(
      flagValue(['--config', 'first.json', '--config=second.json'], ['--config'])
    ).toBe('second.json');
    expect(flagValue(['--json'], ['--config'])).toBeUndefined();
    expect(flagValue(['--config'], ['--config'])).toBeUndefined();
  });
});

describe('hasFlag and isReservedArg', () => {
  it('matches bare boolean flags and ignores --name=value forms', () => {
    expect(hasFlag(['--json', '0xab'], ['--json'])).toBe(true);
    expect(hasFlag(['--json=true'], ['--json'])).toBe(false);
    expect(hasFlag(['--help'], ['--help', '-h'])).toBe(true);
    expect(hasFlag(['-V'], ['--version', '-V'])).toBe(true);
    expect(hasFlag(['--schema'], ['--help'])).toBe(false);
  });

  it('treats known flags and their values as reserved so they are not calldata', () => {
    const argv = ['--from', '0x' + '11'.repeat(20), '--json', '0xab'];
    expect(isReservedArg(argv, 0)).toBe(true);
    expect(isReservedArg(argv, 1)).toBe(true);
    expect(isReservedArg(argv, 2)).toBe(true);
    expect(isReservedArg(argv, 3)).toBe(false);
    expect(isReservedArg(['--from=0xab'], 0)).toBe(true);
  });
});

describe('CLI_USAGE_LINES', () => {
  it('starts with the usage synopsis the e2e tests match', () => {
    expect(CLI_USAGE_LINES[0]).toMatch(/^Usage: tx-sim-risk /);
    expect(CLI_USAGE_LINES.join('\n')).toContain('--version');
    expect(CLI_USAGE_LINES.join('\n')).toContain('--help');
  });
});

describe('reportOptionsFromArgv', () => {
  it('returns undefined when neither --from nor --config is set', () => {
    expect(reportOptionsFromArgv(['--json', '0xabc'])).toBeUndefined();
  });

  it('passes --from through without requiring a config file', () => {
    const options = reportOptionsFromArgv(['--from', '0x' + '11'.repeat(20)]);
    expect(options?.from).toBe('0x' + '11'.repeat(20));
    expect(options?.lists).toBeUndefined();
  });

  it('loads --config into report options used by generateJsonReport', () => {
    const options = reportOptionsFromArgv(['--config', EXAMPLE_CONFIG]);
    expect(options?.lists).toBeDefined();
    const report = generateJsonReport(approve(BLOCKED, '64'), options)!;
    expect(report.risks).toContain(BLOCKLISTED_SPENDER_RISK);
  });

  it('throws when --config points at a missing file', () => {
    expect(() =>
      reportOptionsFromArgv(['--config', join(tmpdir(), 'no-such-lists.json')])
    ).toThrow(/Cannot read config/);
  });

  it('throws when --config is not valid JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tx-sim-risk-cli-'));
    const path = join(dir, 'bad.json');
    writeFileSync(path, '{');
    expect(() => reportOptionsFromArgv(['--config=' + path])).toThrow(
      /is not valid JSON/
    );
  });
});

describe('example risk-lists.json', () => {
  it('allows the Uniswap V2 router and blocks the fixture spender', () => {
    const lists = loadAddressLists(EXAMPLE_CONFIG);
    expect(isAllowlisted(`0x${ROUTER}`, lists)).toBe(true);
    expect(isBlocklisted(`0x${BLOCKED}`, lists)).toBe(true);
  });
});
