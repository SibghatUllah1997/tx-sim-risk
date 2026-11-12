import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import {
  loadDataset,
  reportOptionsForCase,
} from '../src/dataset';
import { generateJsonReportFromAny } from '../src/report';
import { loadReportSchema } from '../src/schema';
import { isValidReport, validateJsonSchema } from '../src/schemaValidate';

const DATASET_PATH = resolve(__dirname, '..', 'examples', 'dataset', 'cases.json');
const DATASET_DIR = resolve(__dirname, '..', 'examples', 'dataset');

describe('example dataset vs report schema', () => {
  it('produces a schema-valid JSON report for every case', () => {
    const schema = loadReportSchema();
    const { cases } = loadDataset(DATASET_PATH);
    expect(cases.length).toBeGreaterThanOrEqual(19);
    for (const c of cases) {
      const report = generateJsonReportFromAny(
        c.input,
        reportOptionsForCase(c, DATASET_DIR)
      );
      expect(report, c.id).not.toBeNull();
      const result = validateJsonSchema(report, schema);
      expect(result.errors, `${c.id}: ${JSON.stringify(result.errors)}`).toEqual(
        []
      );
      expect(isValidReport(report, schema)).toBe(true);
    }
  });
});
