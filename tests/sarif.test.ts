import { describe, it, expect } from 'vitest';
import { encodeFunctionData, parseAbi, type Hex } from 'viem';
import {
  DEFAULT_SARIF_URI,
  SARIF_SCHEMA_URI,
  SARIF_VERSION,
  reportToSarif,
  sarifLevelForSeverity,
  sarifRuleForRisk,
} from '../src/sarif';
import {
  BURN_TO_ZERO_ADDRESS_RISK,
  KNOWN_RISK_IDS,
  MULTICALL_BATCHED_GRANT_RISK,
  RISK_REASONS,
  UNLIMITED_APPROVAL_RISK,
  describeRisks,
} from '../src';
import {
  generateJsonReport,
  generateJsonReportFromAny,
  pluginDecodeReport,
} from '../src/report';
import { readPackageVersion } from '../src/packageInfo';
import { MAX_UINT256 } from '../src/evm/hex';

function word(hexNoPrefix: string): string {
  return hexNoPrefix.padStart(64, '0');
}

function approve(spenderNo0x: string, amountHex: string): string {
  return `0x095ea7b3${word(`000000000000000000000000${spenderNo0x}`)}${word(amountHex)}`;
}

function transfer(toNo0x: string, amountHex: string): string {
  return `0xa9059cbb${word(`000000000000000000000000${toNo0x}`)}${word(amountHex)}`;
}

const ROUTER = '7a250d5630b4cf539739df2c5dacb4c659f2488d';

describe('sarifLevelForSeverity', () => {
  it('maps high to error, warn to warning, and info to note', () => {
    expect(sarifLevelForSeverity('high')).toBe('error');
    expect(sarifLevelForSeverity('warn')).toBe('warning');
    expect(sarifLevelForSeverity('info')).toBe('note');
  });
});

describe('reportToSarif', () => {
  it('emits a SARIF 2.1.0 log with tool metadata and one result per risk', () => {
    const report = generateJsonReport(approve(ROUTER, 'f'.repeat(64)))!;
    const log = reportToSarif(report);
    expect(log.$schema).toBe(SARIF_SCHEMA_URI);
    expect(log.version).toBe(SARIF_VERSION);
    expect(log.runs).toHaveLength(1);
    const run = log.runs[0]!;
    expect(run.tool.driver.name).toBe('tx-sim-risk');
    expect(run.tool.driver.version).toBe(readPackageVersion());
    expect(run.tool.driver.informationUri).toContain('tx-sim-risk');
    expect(run.tool.driver.rules.map((rule) => rule.id)).toEqual(
      expect.arrayContaining([...KNOWN_RISK_IDS])
    );
    expect(run.results).toHaveLength(report.risks.length);
    const unlimited = run.results.find((r) => r.ruleId === UNLIMITED_APPROVAL_RISK);
    expect(unlimited).toMatchObject({
      level: 'error',
      message: {
        text: `${UNLIMITED_APPROVAL_RISK}: ${RISK_REASONS[UNLIMITED_APPROVAL_RISK]}`,
      },
      properties: { reportType: 'erc20_approve', severity: 'high' },
    });
    expect(unlimited?.locations[0]?.physicalLocation.artifactLocation.uri).toBe(
      DEFAULT_SARIF_URI
    );
    expect(unlimited?.locations[0]?.physicalLocation.region.startLine).toBe(1);
  });

  it('maps a burn transfer to a warning and honors --sarif-uri', () => {
    const report = generateJsonReport(transfer('0'.repeat(40), '1'))!;
    const log = reportToSarif(report, { uri: 'examples/dataset/cases.json' });
    expect(log.runs[0]!.results).toEqual([
      expect.objectContaining({
        ruleId: BURN_TO_ZERO_ADDRESS_RISK,
        level: 'warning',
      }),
    ]);
    expect(
      log.runs[0]!.results[0]!.locations[0]!.physicalLocation.artifactLocation.uri
    ).toBe('examples/dataset/cases.json');
  });

  it('can emit only a subset of risks for --diff --sarif', () => {
    const report = generateJsonReport(approve(ROUTER, 'f'.repeat(64)))!;
    expect(report.risks.length).toBeGreaterThan(0);
    const log = reportToSarif(report, { onlyRiskIds: [] });
    expect(log.runs[0]!.results).toEqual([]);
    const filtered = reportToSarif(report, {
      onlyRiskIds: [UNLIMITED_APPROVAL_RISK],
    });
    expect(filtered.runs[0]!.results.every((r) => r.ruleId === UNLIMITED_APPROVAL_RISK)).toBe(
      true
    );
  });

  it('returns an empty results array for a clean report so CI still gets a log', () => {
    const report = generateJsonReport(approve(ROUTER, '1'))!;
    expect(report.risks).toEqual([]);
    const log = reportToSarif(report);
    expect(log.runs[0]!.results).toEqual([]);
    expect(log.runs[0]!.tool.driver.rules.length).toBe(KNOWN_RISK_IDS.length);
  });

  it('adds a rule for an unknown plugin risk id', () => {
    const report = pluginDecodeReport(
      { id: 'cosmos', name: 'Cosmos' },
      { summary: 'bank send', risks: ['custom_risk'] }
    );
    const log = reportToSarif(report);
    expect(log.runs[0]!.tool.driver.rules.some((r) => r.id === 'custom_risk')).toBe(
      true
    );
    expect(log.runs[0]!.results[0]).toMatchObject({
      ruleId: 'custom_risk',
      level: 'warning',
    });
  });

  it('surfaces rolled-up multicall inner risks as top-level results', () => {
    const erc20 = parseAbi(['function approve(address spender, uint256 value)']);
    const batch = parseAbi(['function multicall(bytes[] data)']);
    const inner = encodeFunctionData({
      abi: erc20,
      functionName: 'approve',
      args: [`0x${ROUTER}`, MAX_UINT256],
    });
    const data = encodeFunctionData({
      abi: batch,
      functionName: 'multicall',
      args: [[inner as Hex]],
    });
    const report = generateJsonReportFromAny(data)!;
    expect(report.type).toBe('multicall');
    expect(report.risks).toEqual(
      expect.arrayContaining([UNLIMITED_APPROVAL_RISK, MULTICALL_BATCHED_GRANT_RISK])
    );
    const ids = reportToSarif(report).runs[0]!.results.map((r) => r.ruleId);
    expect(ids).toEqual(
      expect.arrayContaining([UNLIMITED_APPROVAL_RISK, MULTICALL_BATCHED_GRANT_RISK])
    );
  });
});

describe('sarifRuleForRisk', () => {
  it('uses the catalog reason as the full description', () => {
    const rule = sarifRuleForRisk(UNLIMITED_APPROVAL_RISK);
    expect(rule.shortDescription.text).toBe('unlimited approval');
    expect(rule.fullDescription.text).toBe(RISK_REASONS[UNLIMITED_APPROVAL_RISK]);
    expect(rule.defaultConfiguration.level).toBe('error');
    expect(describeRisks([UNLIMITED_APPROVAL_RISK])[0]?.reason).toBe(
      rule.help.text
    );
  });
});
