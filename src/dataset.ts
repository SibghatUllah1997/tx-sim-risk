import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { loadAddressLists } from './config';
import {
  generateJsonReportFromAny,
  type JsonReport,
  type ReportOptions,
} from './report';
import type { RiskSeverity } from './risks';

/** Current on-disk format of `examples/dataset/cases.json`. */
export const DATASET_VERSION = 1;

export type DatasetChain = 'evm' | 'solana';

/** What a case must decode to. Risks are compared as an ordered list. */
export type DatasetExpectation = {
  type: JsonReport['type'];
  risks: string[];
  severity: RiskSeverity;
};

/**
 * One labelled input. Every field maps to a CLI flag, so any case can be
 * replayed by hand: `tx-sim-risk <input> [--from <from>] [--config <config>]`.
 */
export type DatasetCase = {
  id: string;
  chain: DatasetChain;
  description: string;
  input: string;
  /** Sender passed as `--from`. */
  from?: string;
  /** Allow/block list path, relative to the dataset file. */
  config?: string;
  expect: DatasetExpectation;
};

export type Dataset = {
  version: number;
  cases: DatasetCase[];
};

const CHAINS: readonly DatasetChain[] = ['evm', 'solana'];
const SEVERITIES: readonly RiskSeverity[] = ['info', 'warn', 'high'];
const REPORT_TYPES: readonly JsonReport['type'][] = [
  'erc20_approve',
  'erc20_transfer',
  'erc20_increaseAllowance',
  'erc20_decreaseAllowance',
  'nft_setApprovalForAll',
  'abi_call',
  'solana_tx',
  'plugin_decode',
];
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(
  obj: Record<string, unknown>,
  key: string,
  where: string
): string {
  const value = obj[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${where}: "${key}" must be a non-empty string`);
  }
  return value;
}

function optionalString(
  obj: Record<string, unknown>,
  key: string,
  where: string
): string | undefined {
  if (obj[key] === undefined) return undefined;
  return requireString(obj, key, where);
}

function oneOf<T extends string>(
  value: string,
  allowed: readonly T[],
  label: string
): T {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new Error(`${label} must be one of ${allowed.join(', ')}`);
  }
  return value as T;
}

function parseExpectation(input: unknown, where: string): DatasetExpectation {
  if (!isRecord(input)) throw new Error(`${where}: "expect" must be an object`);
  const type = oneOf(
    requireString(input, 'type', `${where}.expect`),
    REPORT_TYPES,
    `${where}.expect.type`
  );
  const severity = oneOf(
    requireString(input, 'severity', `${where}.expect`),
    SEVERITIES,
    `${where}.expect.severity`
  );
  const risks = input.risks;
  if (!Array.isArray(risks) || risks.some((r) => typeof r !== 'string')) {
    throw new Error(`${where}.expect: "risks" must be an array of strings`);
  }
  return { type, risks: [...risks], severity };
}

function parseCase(input: unknown, index: number): DatasetCase {
  const where = `cases[${index}]`;
  if (!isRecord(input)) throw new Error(`${where} must be an object`);
  const id = requireString(input, 'id', where);
  if (!ID_PATTERN.test(id)) {
    throw new Error(`${where}: id "${id}" must be lowercase kebab-case`);
  }
  const parsed: DatasetCase = {
    id,
    chain: oneOf(requireString(input, 'chain', where), CHAINS, `${where}.chain`),
    description: requireString(input, 'description', where),
    input: requireString(input, 'input', where),
    expect: parseExpectation(input.expect, where),
  };
  const from = optionalString(input, 'from', where);
  if (from) parsed.from = from;
  const config = optionalString(input, 'config', where);
  if (config) {
    if (isAbsolute(config)) {
      throw new Error(`${where}: "config" must be a relative path`);
    }
    parsed.config = config;
  }
  return parsed;
}

/** Validate untrusted JSON and return a typed dataset. Ids must be unique. */
export function parseDataset(input: unknown): Dataset {
  if (!isRecord(input)) throw new Error('dataset must be a JSON object');
  if (input.version !== DATASET_VERSION) {
    throw new Error(
      `unsupported dataset version ${String(input.version)} (expected ${DATASET_VERSION})`
    );
  }
  if (!Array.isArray(input.cases)) {
    throw new Error('dataset "cases" must be an array');
  }
  const cases = input.cases.map(parseCase);
  const seen = new Set<string>();
  for (const c of cases) {
    if (seen.has(c.id)) throw new Error(`duplicate case id "${c.id}"`);
    seen.add(c.id);
  }
  return { version: DATASET_VERSION, cases };
}

/** Read and validate a dataset file. Errors name the file. */
export function loadDataset(path: string): Dataset {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    throw new Error(`Cannot read dataset ${path}: ${(err as Error).message}`);
  }
  try {
    return parseDataset(JSON.parse(raw));
  } catch (err) {
    throw new Error(`Invalid dataset ${path}: ${(err as Error).message}`);
  }
}

/** Report options a case implies, resolving `config` against `baseDir`. */
export function reportOptionsForCase(
  c: DatasetCase,
  baseDir: string
): ReportOptions | undefined {
  if (!c.from && !c.config) return undefined;
  const options: ReportOptions = {};
  if (c.from) options.from = c.from;
  if (c.config) options.lists = loadAddressLists(resolve(baseDir, c.config));
  return options;
}

/** CLI arguments that replay a case (without output-format flags). */
export function cliArgsForCase(c: DatasetCase, baseDir: string): string[] {
  const args = [c.input];
  if (c.from) args.push('--from', c.from);
  if (c.config) args.push('--config', resolve(baseDir, c.config));
  return args;
}

/**
 * Compare a report with what a case expects. Returns human-readable
 * differences; an empty list means the case passes.
 */
export function diffExpectation(
  expected: DatasetExpectation,
  report: JsonReport | null
): string[] {
  if (!report) return ['input did not decode to a report'];
  const problems: string[] = [];
  if (report.type !== expected.type) {
    problems.push(`type: expected ${expected.type}, got ${report.type}`);
  }
  if (report.severity !== expected.severity) {
    problems.push(
      `severity: expected ${expected.severity}, got ${report.severity}`
    );
  }
  const want = expected.risks.join(',');
  const got = report.risks.join(',');
  if (want !== got) {
    problems.push(`risks: expected [${want}], got [${got}]`);
  }
  return problems;
}

export type DatasetCaseResult = {
  id: string;
  problems: string[];
};

/** Decode every case in-process and collect expectation mismatches. */
export function checkDataset(
  dataset: Dataset,
  baseDir: string
): DatasetCaseResult[] {
  return dataset.cases.map((c) => {
    let report: JsonReport | null;
    try {
      report = generateJsonReportFromAny(c.input, reportOptionsForCase(c, baseDir));
    } catch (err) {
      return { id: c.id, problems: [`threw: ${(err as Error).message}`] };
    }
    return { id: c.id, problems: diffExpectation(c.expect, report) };
  });
}

/** Load a dataset file and check it, resolving configs next to the file. */
export function checkDatasetFile(path: string): DatasetCaseResult[] {
  return checkDataset(loadDataset(path), dirname(resolve(path)));
}
