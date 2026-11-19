import { liveCallRisks, type LiveCallResult } from './evm/liveCall';
import type { JsonReport } from './report';
import { describeRisks, highestSeverity } from './risks';

/**
 * Attach a live-call outcome to a decoded report. A revert adds the
 * `live_call_reverted` risk and severity is recomputed; the offline
 * decode and simulation are left untouched.
 */
export function withLiveCall(report: JsonReport, liveCall: LiveCallResult): JsonReport {
  const added = liveCallRisks(liveCall).filter((id) => !report.risks.includes(id));
  const risks = [...report.risks, ...added];
  return {
    ...report,
    risks,
    riskDetails: describeRisks(risks),
    severity: highestSeverity(risks),
    liveCall,
  } as JsonReport;
}
