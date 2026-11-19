import type { JsonReport } from './report';
import type { RiskSeverity } from './risks';

export type DiffAddressRole =
  | 'spender'
  | 'operator'
  | 'recipient'
  | 'delegate'
  | 'paymaster'
  | 'authority';

export type DiffAddressHit = {
  address: string;
  role: DiffAddressRole;
};

export type AmountChange = {
  field: string;
  before: string | null;
  after: string | null;
};

export type TxDiff = {
  type: 'tx_diff';
  baseline: { type: string | null; severity: RiskSeverity | null };
  candidate: { type: string | null; severity: RiskSeverity | null };
  addedRisks: string[];
  removedRisks: string[];
  addedAddresses: DiffAddressHit[];
  removedAddresses: DiffAddressHit[];
  amountChanges: AmountChange[];
};

function addressKey(hit: DiffAddressHit): string {
  return `${hit.role}:${hit.address.toLowerCase()}`;
}

function pushAddress(
  out: DiffAddressHit[],
  address: string | null | undefined,
  role: DiffAddressRole
): void {
  if (!address) return;
  const hit = { address: address.toLowerCase(), role };
  if (!out.some((item) => addressKey(item) === addressKey(hit))) {
    out.push(hit);
  }
}

function collectAddresses(report: JsonReport, out: DiffAddressHit[]): void {
  switch (report.type) {
    case 'erc20_approve':
    case 'erc20_permit':
    case 'erc20_increaseAllowance':
    case 'erc20_decreaseAllowance':
      pushAddress(out, report.payload.spender, 'spender');
      return;
    case 'permit2':
      pushAddress(out, report.payload.spender, 'spender');
      pushAddress(out, report.payload.to, 'recipient');
      return;
    case 'nft_setApprovalForAll':
      pushAddress(out, report.payload.operator, 'operator');
      return;
    case 'erc20_transfer':
      pushAddress(out, report.payload.to, 'recipient');
      return;
    case 'native_transfer':
      pushAddress(out, report.payload.to, 'recipient');
      return;
    case 'eip7702':
      for (const item of report.payload.authorizations) {
        pushAddress(out, item.address, 'delegate');
      }
      if (report.payload.innerReport) {
        collectAddresses(report.payload.innerReport, out);
      }
      return;
    case 'erc4337_userop':
      for (const op of report.payload.ops) {
        pushAddress(out, op.paymaster, 'paymaster');
        for (const call of op.calls) {
          if (call.report) collectAddresses(call.report, out);
        }
      }
      return;
    case 'multicall':
      for (const call of report.payload.calls) {
        if (call.report) collectAddresses(call.report, out);
      }
      return;
    case 'solana_tx':
      for (const spl of report.payload.splTokenInstructions) {
        pushAddress(out, spl.destination, 'recipient');
        pushAddress(out, spl.newAuthority, 'authority');
      }
      return;
    default:
      return;
  }
}

function collectAmounts(
  report: JsonReport,
  out: Map<string, string>,
  prefix = ''
): void {
  const field = (name: string) => (prefix ? `${prefix}.${name}` : name);
  const set = (name: string, value: string | null | undefined) => {
    if (value == null) return;
    out.set(field(name), value);
  };
  switch (report.type) {
    case 'erc20_approve':
      set('amount', report.payload.amount);
      return;
    case 'erc20_permit':
      set('value', report.payload.value);
      return;
    case 'permit2':
      set('amount', report.payload.amount);
      if (report.payload.requestedAmount != null) {
        set('requestedAmount', report.payload.requestedAmount);
      }
      report.payload.allowances.forEach((item, index) => {
        set(`allowances[${index}].amount`, item.amount);
      });
      return;
    case 'erc20_transfer':
      set('amount', report.payload.amount);
      return;
    case 'erc20_increaseAllowance':
    case 'erc20_decreaseAllowance':
      set('amountDelta', report.payload.amountDelta);
      return;
    case 'native_transfer':
      set('value', report.payload.value);
      return;
    case 'eip7702':
      set('value', report.payload.value);
      if (report.payload.innerReport) {
        collectAmounts(report.payload.innerReport, out, field('inner'));
      }
      return;
    case 'erc4337_userop':
      report.payload.ops.forEach((op, opIndex) => {
        op.calls.forEach((call, callIndex) => {
          set(`ops[${opIndex}].calls[${callIndex}].value`, call.value);
          if (call.report) {
            collectAmounts(
              call.report,
              out,
              field(`ops[${opIndex}].calls[${callIndex}]`)
            );
          }
        });
      });
      return;
    case 'multicall':
      set('totalValue', report.payload.totalValue);
      report.payload.calls.forEach((call, index) => {
        if (call.value != null) set(`calls[${index}].value`, call.value);
        if (call.report) {
          collectAmounts(call.report, out, field(`calls[${index}]`));
        }
      });
      return;
    case 'solana_tx':
      report.payload.splTokenInstructions.forEach((spl, index) => {
        if (spl.amount != null) set(`spl[${index}].amount`, spl.amount);
      });
      return;
    default:
      return;
  }
}

function sortedRisks(report: JsonReport | null): string[] {
  return report ? [...report.risks] : [];
}

function setDiff<T>(before: readonly T[], after: readonly T[]): {
  added: T[];
  removed: T[];
} {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  return {
    added: after.filter((item) => !beforeSet.has(item)),
    removed: before.filter((item) => !afterSet.has(item)),
  };
}

/**
 * Compare two decoded reports. Highlights risks, grant/transfer
 * addresses, and named amounts that appear only on the candidate
 * (or only on the baseline).
 */
export function diffReports(
  baseline: JsonReport | null,
  candidate: JsonReport | null
): TxDiff {
  const beforeRisks = sortedRisks(baseline);
  const afterRisks = sortedRisks(candidate);
  const riskDelta = setDiff(beforeRisks, afterRisks);

  const beforeHits: DiffAddressHit[] = [];
  const afterHits: DiffAddressHit[] = [];
  if (baseline) collectAddresses(baseline, beforeHits);
  if (candidate) collectAddresses(candidate, afterHits);
  const beforeKeys = beforeHits.map(addressKey);
  const afterKeys = afterHits.map(addressKey);
  const addressDelta = setDiff(beforeKeys, afterKeys);
  const hitByKey = (hits: DiffAddressHit[], key: string) =>
    hits.find((hit) => addressKey(hit) === key)!;

  const beforeAmounts = new Map<string, string>();
  const afterAmounts = new Map<string, string>();
  if (baseline) collectAmounts(baseline, beforeAmounts);
  if (candidate) collectAmounts(candidate, afterAmounts);
  const amountFields = new Set([...beforeAmounts.keys(), ...afterAmounts.keys()]);
  const amountChanges: AmountChange[] = [];
  for (const field of [...amountFields].sort()) {
    const before = beforeAmounts.get(field) ?? null;
    const after = afterAmounts.get(field) ?? null;
    if (before === after) continue;
    amountChanges.push({ field, before, after });
  }

  return {
    type: 'tx_diff',
    baseline: {
      type: baseline?.type ?? null,
      severity: baseline?.severity ?? null,
    },
    candidate: {
      type: candidate?.type ?? null,
      severity: candidate?.severity ?? null,
    },
    addedRisks: riskDelta.added,
    removedRisks: riskDelta.removed,
    addedAddresses: addressDelta.added.map((key) => hitByKey(afterHits, key)),
    removedAddresses: addressDelta.removed.map((key) => hitByKey(beforeHits, key)),
    amountChanges,
  };
}

function formatAddressHits(hits: readonly DiffAddressHit[]): string {
  if (hits.length === 0) return '(none)';
  return hits.map((hit) => `${hit.role} ${hit.address}`).join(', ');
}

/** Plain-text lines for `--diff` CLI output. */
export function formatTxDiff(diff: TxDiff): string[] {
  const lines = [
    `Diff: ${diff.baseline.type ?? 'unknown'} -> ${diff.candidate.type ?? 'unknown'}`,
    `Severity: ${diff.baseline.severity ?? 'n/a'} -> ${diff.candidate.severity ?? 'n/a'}`,
    `Added risks: ${diff.addedRisks.length > 0 ? diff.addedRisks.join(', ') : '(none)'}`,
    `Removed risks: ${diff.removedRisks.length > 0 ? diff.removedRisks.join(', ') : '(none)'}`,
    `Added addresses: ${formatAddressHits(diff.addedAddresses)}`,
    `Removed addresses: ${formatAddressHits(diff.removedAddresses)}`,
  ];
  if (diff.amountChanges.length === 0) {
    lines.push('Amount changes: (none)');
  } else {
    lines.push('Amount changes:');
    for (const change of diff.amountChanges) {
      lines.push(
        `  ${change.field}: ${change.before ?? 'n/a'} -> ${change.after ?? 'n/a'}`
      );
    }
  }
  return lines;
}
