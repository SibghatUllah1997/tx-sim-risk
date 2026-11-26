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
    case 'safe_exec':
      if (report.payload.operation === 'delegatecall') {
        pushAddress(out, report.payload.to, 'delegate');
      } else if (report.payload.data === '0x') {
        pushAddress(out, report.payload.to, 'recipient');
      }
      if (report.payload.innerReport) {
        collectAddresses(report.payload.innerReport, out);
      }
      return;
    case 'universal_router':
      for (const command of report.payload.commands) {
        pushAddress(out, command.spender, 'spender');
        pushAddress(out, command.recipient, 'recipient');
        if (command.innerReport) collectAddresses(command.innerReport, out);
      }
      return;
    case 'cowswap':
      for (const trade of report.payload.trades) {
        if (!trade.receiverIsOwner) {
          pushAddress(out, trade.receiver, 'recipient');
        }
      }
      for (const item of report.payload.interactions) {
        if (item.data === '0x') {
          pushAddress(out, item.target, 'recipient');
        }
        if (item.innerReport) collectAddresses(item.innerReport, out);
      }
      return;
    case 'oneinch':
      pushAddress(out, report.payload.dstReceiver, 'recipient');
      pushAddress(out, report.payload.recipient, 'recipient');
      if (report.payload.permitReport) {
        collectAddresses(report.payload.permitReport, out);
      }
      if (report.payload.executorReport) {
        collectAddresses(report.payload.executorReport, out);
      }
      return;
    case 'seaport':
      pushAddress(out, report.payload.recipient, 'recipient');
      for (const item of report.payload.consideration) {
        pushAddress(out, item.recipient, 'recipient');
      }
      for (const item of report.payload.additionalRecipients) {
        pushAddress(out, item.recipient, 'recipient');
      }
      if (report.payload.extraReport) {
        collectAddresses(report.payload.extraReport, out);
      }
      return;
    case 'zeroex':
      pushAddress(out, report.payload.taker, 'recipient');
      pushAddress(out, report.payload.feeRecipient, 'recipient');
      pushAddress(out, report.payload.txOrigin, 'recipient');
      for (const fee of report.payload.fees) {
        pushAddress(out, fee.recipient, 'recipient');
      }
      if (report.payload.callReport) {
        collectAddresses(report.payload.callReport, out);
      }
      for (const item of report.payload.transformations) {
        if (item.innerReport) collectAddresses(item.innerReport, out);
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
    case 'safe_exec':
      set('value', report.payload.value);
      if (report.payload.innerReport) {
        collectAmounts(report.payload.innerReport, out, field('inner'));
      }
      return;
    case 'universal_router':
      report.payload.commands.forEach((command, index) => {
        if (command.amount != null) set(`commands[${index}].amount`, command.amount);
        if (command.innerReport) {
          collectAmounts(command.innerReport, out, field(`commands[${index}]`));
        }
      });
      return;
    case 'cowswap':
      report.payload.trades.forEach((trade, index) => {
        set(`trades[${index}].sellAmount`, trade.sellAmount);
        set(`trades[${index}].buyAmount`, trade.buyAmount);
      });
      report.payload.interactions.forEach((item, index) => {
        set(`interactions[${index}].value`, item.value);
        if (item.innerReport) {
          collectAmounts(item.innerReport, out, field(`interactions[${index}]`));
        }
      });
      return;
    case 'oneinch':
      set('amount', report.payload.amount);
      set('minReturn', report.payload.minReturn);
      if (report.payload.permitReport) {
        collectAmounts(report.payload.permitReport, out, field('permit'));
      }
      if (report.payload.executorReport) {
        collectAmounts(report.payload.executorReport, out, field('executor'));
      }
      return;
    case 'seaport':
      report.payload.offer.forEach((item, index) => {
        set(`offer[${index}].amount`, item.startAmount);
      });
      report.payload.consideration.forEach((item, index) => {
        set(`consideration[${index}].amount`, item.startAmount);
      });
      if (report.payload.extraReport) {
        collectAmounts(report.payload.extraReport, out, field('extra'));
      }
      return;
    case 'zeroex':
      set('amount', report.payload.inputTokenAmount);
      set('minReturn', report.payload.minOutputTokenAmount);
      set('takerTokenFillAmount', report.payload.takerTokenFillAmount);
      if (report.payload.callReport) {
        collectAmounts(report.payload.callReport, out, field('call'));
      }
      report.payload.transformations.forEach((item, index) => {
        if (item.innerReport) {
          collectAmounts(
            item.innerReport,
            out,
            field(`transformations[${index}]`)
          );
        }
      });
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
