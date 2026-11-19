import { readPackageVersion } from './packageInfo';
import type { JsonReport } from './report';
import {
  KNOWN_RISK_IDS,
  describeRisks,
  reasonForRisk,
  severityForRisk,
  type RiskDetail,
  type RiskSeverity,
} from './risks';

/** JSON Schema URI consumers (including GitHub) use to identify SARIF 2.1.0. */
export const SARIF_SCHEMA_URI =
  'https://json.schemastore.org/sarif-2.1.0.json';

export const SARIF_VERSION = '2.1.0' as const;

/** Default artifact URI when the caller does not name a file to annotate. */
export const DEFAULT_SARIF_URI = 'transaction';

export type SarifLevel = 'error' | 'warning' | 'note' | 'none';

export type SarifMessage = { text: string };

export type SarifReportingDescriptor = {
  id: string;
  name: string;
  shortDescription: SarifMessage;
  fullDescription: SarifMessage;
  help: SarifMessage;
  defaultConfiguration: { level: SarifLevel };
};

export type SarifResult = {
  ruleId: string;
  ruleIndex: number;
  level: SarifLevel;
  message: SarifMessage;
  locations: Array<{
    physicalLocation: {
      artifactLocation: { uri: string };
      region: { startLine: number; startColumn: number };
    };
  }>;
  properties: {
    reportType: string;
    severity: RiskSeverity;
  };
};

export type SarifLog = {
  $schema: string;
  version: typeof SARIF_VERSION;
  runs: Array<{
    tool: {
      driver: {
        name: string;
        version: string;
        informationUri: string;
        rules: SarifReportingDescriptor[];
      };
    };
    results: SarifResult[];
  }>;
};

export type ReportToSarifOptions = {
  /**
   * Artifact URI GitHub Code Scanning annotates. Point this at a file in
   * the repo (for example `fixtures/tx.hex`) so findings show on the PR.
   */
  uri?: string;
  /** Override the package version recorded on the tool driver. */
  version?: string;
};

/**
 * Map report severity onto SARIF / GitHub annotation levels: high becomes
 * an error, warn a warning, and info a note.
 */
export function sarifLevelForSeverity(severity: RiskSeverity): SarifLevel {
  switch (severity) {
    case 'high':
      return 'error';
    case 'warn':
      return 'warning';
    case 'info':
      return 'note';
  }
}

function titleFromRiskId(id: string): string {
  return id.replace(/_/g, ' ');
}

export function sarifRuleForRisk(id: string): SarifReportingDescriptor {
  const level = sarifLevelForSeverity(severityForRisk(id));
  const reason = reasonForRisk(id);
  return {
    id,
    name: id,
    shortDescription: { text: titleFromRiskId(id) },
    fullDescription: { text: reason },
    help: { text: reason },
    defaultConfiguration: { level },
  };
}

function ruleCatalog(details: readonly RiskDetail[]): SarifReportingDescriptor[] {
  const seen = new Set<string>();
  const rules: SarifReportingDescriptor[] = [];
  for (const id of KNOWN_RISK_IDS) {
    seen.add(id);
    rules.push(sarifRuleForRisk(id));
  }
  for (const detail of details) {
    if (seen.has(detail.id)) continue;
    seen.add(detail.id);
    rules.push(sarifRuleForRisk(detail.id));
  }
  return rules;
}

function detailsFor(report: JsonReport): RiskDetail[] {
  if (report.riskDetails && report.riskDetails.length > 0) {
    return report.riskDetails;
  }
  return describeRisks(report.risks);
}

/**
 * Convert one JSON report into a SARIF 2.1.0 log GitHub Code Scanning can
 * upload. Each risk becomes one result; a clean report has an empty
 * `results` array so CI still gets a valid log.
 */
export function reportToSarif(
  report: JsonReport,
  options?: ReportToSarifOptions
): SarifLog {
  const uri = (options?.uri && options.uri.trim()) || DEFAULT_SARIF_URI;
  const details = detailsFor(report);
  const rules = ruleCatalog(details);
  const indexById = new Map(rules.map((rule, index) => [rule.id, index]));
  const results: SarifResult[] = details.map((detail) => ({
    ruleId: detail.id,
    ruleIndex: indexById.get(detail.id) ?? 0,
    level: sarifLevelForSeverity(detail.severity),
    message: { text: `${detail.id}: ${detail.reason}` },
    locations: [
      {
        physicalLocation: {
          artifactLocation: { uri },
          region: { startLine: 1, startColumn: 1 },
        },
      },
    ],
    properties: {
      reportType: report.type,
      severity: detail.severity,
    },
  }));
  return {
    $schema: SARIF_SCHEMA_URI,
    version: SARIF_VERSION,
    runs: [
      {
        tool: {
          driver: {
            name: 'tx-sim-risk',
            version: options?.version ?? readPackageVersion(),
            informationUri:
              'https://github.com/SibghatUllah1997/tx-sim-risk',
            rules,
          },
        },
        results,
      },
    ],
  };
}
