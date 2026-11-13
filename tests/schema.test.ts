import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  defaultReportSchemaPath,
  loadReportSchema,
} from '../src/schema';

const REQUIRED_DEFS = [
  'erc20ApproveReport',
  'erc20PermitReport',
  'erc20TransferReport',
  'erc20IncreaseAllowanceReport',
  'erc20DecreaseAllowanceReport',
  'nftSetApprovalForAllReport',
  'abiCallReport',
  'solanaTxReport',
  'pluginDecodeReport',
  'unknownReport',
  'simulation',
  'riskDetail',
];

describe('report JSON Schema', () => {
  it('ships at schema/report.schema.json and loads as a Draft 2020-12 document', () => {
    const expected = resolve(__dirname, '..', 'schema', 'report.schema.json');
    expect(defaultReportSchemaPath()).toBe(expected);
    const schema = loadReportSchema();
    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(String(schema.$id)).toMatch(/report\.schema\.json$/);
    expect(schema.title).toBe('tx-sim-risk JSON report');
    expect(Array.isArray(schema.oneOf)).toBe(true);
    expect((schema.oneOf as unknown[]).length).toBe(10);
  });

  it('defines a $defs entry for every report type the decoder can emit', () => {
    const schema = loadReportSchema();
    const defs = schema.$defs as Record<string, unknown>;
    for (const name of REQUIRED_DEFS) {
      expect(defs[name], name).toBeTypeOf('object');
    }
  });

  it('throws when the file is missing, not JSON, or missing $id / oneOf', () => {
    expect(() =>
      loadReportSchema(join(tmpdir(), 'no-such-schema.json'))
    ).toThrow(/Cannot read schema/);

    const dir = mkdtempSync(join(tmpdir(), 'tx-sim-risk-schema-'));
    const badJson = join(dir, 'bad.json');
    writeFileSync(badJson, '{');
    expect(() => loadReportSchema(badJson)).toThrow(/is not valid JSON/);

    const noId = join(dir, 'noid.json');
    writeFileSync(noId, JSON.stringify({ oneOf: [{}], $defs: {} }));
    expect(() => loadReportSchema(noId)).toThrow(/missing \$id/);

    const noOneOf = join(dir, 'nooneof.json');
    writeFileSync(
      noOneOf,
      JSON.stringify({ $id: 'https://example.test/s', $defs: {} })
    );
    expect(() => loadReportSchema(noOneOf)).toThrow(/oneOf/);
  });
});
