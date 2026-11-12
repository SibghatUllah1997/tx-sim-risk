import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { cliArgsForCase, loadDataset } from '../../src/dataset';
import { REPO_ROOT, runCli, runCliJson } from './runCli';

const DATASET_DIR = resolve(REPO_ROOT, 'examples', 'dataset');
const { cases } = loadDataset(resolve(DATASET_DIR, 'cases.json'));

describe('CLI e2e: example dataset', () => {
  it.each(cases.map((c) => [c.id, c] as const))(
    '%s matches its expectation through the real CLI',
    (_id, c) => {
      const args = cliArgsForCase(c, DATASET_DIR);
      const report = runCliJson(args);
      expect({
        type: report.type,
        risks: report.risks,
        severity: report.severity,
      }).toEqual(c.expect);

      const text = runCli(args);
      expect(text.status).toBe(0);
      // The text footer only prints severity and risks when something fired.
      if (c.expect.risks.length > 0) {
        expect(text.stdout).toContain(`Severity: ${c.expect.severity}`);
        expect(text.stdout).toMatch(
          new RegExp(`^Risks: ${c.expect.risks.join(', ?')}$`, 'm')
        );
      } else {
        expect(text.stdout).not.toMatch(/^Risks:/m);
      }
    }
  );
});
