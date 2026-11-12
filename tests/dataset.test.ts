import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  checkDataset,
  checkDatasetFile,
  cliArgsForCase,
  diffExpectation,
  loadDataset,
  parseDataset,
  reportOptionsForCase,
  type DatasetCase,
} from '../src/dataset';
import { buildExampleDataset, serializeDataset } from '../src/datasetCases';
import { generateJsonReportFromAny } from '../src/report';

const DATASET_PATH = resolve(__dirname, '..', 'examples', 'dataset', 'cases.json');
const DATASET_DIR = resolve(__dirname, '..', 'examples', 'dataset');

function validCase(overrides: Partial<DatasetCase> = {}): DatasetCase {
  return {
    id: 'sample-case',
    chain: 'evm',
    description: 'A case.',
    input: '0xdeadbeef',
    expect: { type: 'erc20_approve', risks: [], severity: 'info' },
    ...overrides,
  };
}

describe('example dataset file', () => {
  it('matches what buildExampleDataset produces (run npm run dataset to refresh)', () => {
    expect(readFileSync(DATASET_PATH, 'utf8')).toBe(
      serializeDataset(buildExampleDataset())
    );
  });

  it('is byte-for-byte reproducible across builds', () => {
    expect(serializeDataset(buildExampleDataset())).toBe(
      serializeDataset(buildExampleDataset())
    );
  });

  it('decodes every case to its expected type, risks, and severity', () => {
    const failures = checkDatasetFile(DATASET_PATH).filter(
      (r) => r.problems.length > 0
    );
    expect(failures).toEqual([]);
  });

  it('covers both chains, every severity, and every risk the CLI can reach', () => {
    const { cases } = loadDataset(DATASET_PATH);
    expect(new Set(cases.map((c) => c.chain))).toEqual(new Set(['evm', 'solana']));
    expect(new Set(cases.map((c) => c.expect.severity))).toEqual(
      new Set(['info', 'warn', 'high'])
    );
    const risks = new Set(cases.flatMap((c) => c.expect.risks));
    for (const id of [
      'unlimited_approval',
      'burn_to_zero_address',
      'phishing_spender',
      'blocklisted_spender',
      'erc721_approve_all',
      'erc1155_approve_all',
      'solana_suspicious_cpi',
      'solana_ata_mismatch',
    ]) {
      expect(risks, id).toContain(id);
    }
  });

  it('needs the example block list for the blocklisted case', () => {
    const c = loadDataset(DATASET_PATH).cases.find(
      (x) => x.id === 'erc20-blocklisted-approve'
    )!;
    const withoutConfig = generateJsonReportFromAny(c.input);
    expect(withoutConfig!.risks).toEqual([]);
    const withConfig = generateJsonReportFromAny(
      c.input,
      reportOptionsForCase(c, DATASET_DIR)
    );
    expect(withConfig!.risks).toEqual(['blocklisted_spender']);
  });
});

describe('parseDataset', () => {
  it('accepts a minimal valid dataset and keeps optional fields', () => {
    const parsed = parseDataset({
      version: 1,
      cases: [validCase({ from: '0xabc', config: 'lists.json' })],
    });
    expect(parsed.cases[0]).toMatchObject({ from: '0xabc', config: 'lists.json' });
  });

  it.each([
    [null, /JSON object/],
    [{ version: 2, cases: [] }, /unsupported dataset version 2/],
    [{ version: 1 }, /"cases" must be an array/],
    [{ version: 1, cases: [validCase({ id: 'Bad Id' })] }, /kebab-case/],
    [{ version: 1, cases: [validCase({ chain: 'btc' as never })] }, /chain must be one of/],
    [{ version: 1, cases: [validCase({ input: ' ' })] }, /"input" must be a non-empty string/],
    [{ version: 1, cases: [validCase({ config: '/etc/lists.json' })] }, /relative path/],
    [
      { version: 1, cases: [validCase({ expect: { type: 'nope', risks: [], severity: 'info' } as never })] },
      /expect\.type must be one of/,
    ],
    [
      { version: 1, cases: [validCase({ expect: { type: 'abi_call', risks: [1], severity: 'info' } as never })] },
      /"risks" must be an array of strings/,
    ],
    [{ version: 1, cases: [validCase(), validCase()] }, /duplicate case id "sample-case"/],
  ])('rejects %j', (input, message) => {
    expect(() => parseDataset(input)).toThrow(message);
  });

  it('names the file when loading fails', () => {
    expect(() => loadDataset('missing/cases.json')).toThrow(
      /^Cannot read dataset missing\/cases\.json/
    );
  });
});

describe('diffExpectation and checkDataset', () => {
  it('lists each mismatched field', () => {
    const report = generateJsonReportFromAny(
      buildExampleDataset().cases[0]!.input
    );
    expect(
      diffExpectation({ type: 'erc20_transfer', risks: [], severity: 'info' }, report)
    ).toEqual([
      'type: expected erc20_transfer, got erc20_approve',
      'severity: expected info, got high',
      'risks: expected [], got [unlimited_approval]',
    ]);
  });

  it('treats risk order as significant', () => {
    const nft = buildExampleDataset().cases.find((c) => c.id === 'nft-approve-all')!;
    const report = generateJsonReportFromAny(nft.input);
    const swapped = { ...nft.expect, risks: [...nft.expect.risks].reverse() };
    expect(diffExpectation(swapped, report)).toHaveLength(1);
  });

  it('reports undecodable input and config errors per case', () => {
    const results = checkDataset(
      {
        version: 1,
        cases: [
          validCase({ id: 'junk' }),
          validCase({ id: 'bad-config', input: buildExampleDataset().cases[0]!.input, config: 'nope.json' }),
        ],
      },
      DATASET_DIR
    );
    expect(results[0]).toEqual({ id: 'junk', problems: ['input did not decode to a report'] });
    expect(results[1]!.problems[0]).toMatch(/^threw: Cannot read config/);
  });

  it('builds replayable CLI args with an absolute config path', () => {
    const c = validCase({ from: '0x1', config: '../risk-lists.json' });
    expect(cliArgsForCase(c, DATASET_DIR)).toEqual([
      '0xdeadbeef',
      '--from',
      '0x1',
      '--config',
      resolve(DATASET_DIR, '..', 'risk-lists.json'),
    ]);
  });
});
