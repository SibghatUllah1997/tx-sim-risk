import type { TxDiff } from './diff';
import {
  formatAtaLine,
  formatCpiLine,
  formatSplTokenLine,
  type JsonReport,
} from './report';
import type { SimulationSnapshot } from './sim';
import { formatLiveCallLine } from './evm/liveCall';

const HTML_ESCAPES: Readonly<Record<string, string>> = Object.freeze({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
});

/** Escape text for safe use in HTML element content and quoted attributes. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]!);
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value, (_k, v) =>
    typeof v === 'bigint' ? v.toString() : v
  );
}

function row(label: string, value: string): string {
  return `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`;
}

function payloadRows(report: JsonReport): string[] {
  if (report.type === 'abi_call') {
    const { functionName, signature, selector, standards, args } =
      report.payload;
    return [
      row('function', functionName),
      row('signature', signature),
      row('selector', selector),
      row('standards', standards.join(', ')),
      ...args.map((arg) => row(`${arg.name} (${arg.type})`, formatValue(arg.value))),
    ];
  }
  if (report.type === 'native_transfer') {
    const payload = report.payload;
    return [
      row('txType', payload.txType),
      row('chainId', payload.chainId ?? 'unknown'),
      row('to', payload.to ?? 'contract creation'),
      row('value (wei)', payload.value),
      row('recipientKind', payload.recipientKind ?? 'n/a'),
      row(
        'recipientLabel',
        payload.recipientLabel
          ? `${payload.recipientLabel.name} (${payload.recipientLabel.kind})`
          : ''
      ),
    ];
  }
  if (report.type === 'universal_router') {
    const payload = report.payload;
    return [
      row('variant', payload.variant),
      row('signature', payload.signature),
      row('deadline', payload.deadline ?? ''),
      row('commands', String(payload.commands.length)),
      ...payload.commands.map((command) =>
        row(
          `command ${command.index}`,
          `${command.kind}${command.allowRevert ? ' allowRevert' : ''}${command.spender ? ` spender=${command.spender}` : ''}${command.recipient ? ` recipient=${command.recipient}` : ''} type=${command.innerReport?.type ?? 'none'} risks=${(command.innerReport?.risks ?? []).join(',')}`
        )
      ),
    ];
  }
  if (report.type === 'oneinch') {
    const payload = report.payload;
    const rows = [
      row('variant', payload.variant),
      row('signature', payload.signature),
      row('amount', payload.amount ?? ''),
      row('minReturn', payload.minReturn ?? ''),
    ];
    if (payload.executor) rows.push(row('executor', payload.executor));
    if (payload.srcToken) {
      rows.push(
        row(
          'srcToken',
          `${payload.srcToken}${payload.srcIsEth ? ' (native ETH)' : ''}`
        )
      );
    }
    if (payload.dstToken) {
      rows.push(
        row(
          'dstToken',
          `${payload.dstToken}${payload.dstIsEth ? ' (native ETH)' : ''}`
        )
      );
    }
    if (payload.dstReceiver) rows.push(row('dstReceiver', payload.dstReceiver));
    if (payload.recipient) rows.push(row('recipient', payload.recipient));
    if (payload.clipperExchange) {
      rows.push(row('clipperExchange', payload.clipperExchange));
    }
    if (payload.pools.length > 0) {
      rows.push(row('pools', String(payload.pools.length)));
    }
    rows.push(
      row(
        'permit',
        payload.permitReport
          ? `${payload.permitReport.type} risks=${payload.permitReport.risks.join(',')}`
          : payload.permit === '0x'
            ? 'none'
            : payload.permitDepthLimited
              ? 'not analyzed (depth limit)'
              : 'unknown'
      )
    );
    rows.push(
      row(
        'executor data',
        payload.executorReport
          ? `${payload.executorReport.type} risks=${payload.executorReport.risks.join(',')}`
          : payload.executorData === '0x'
            ? 'none'
            : payload.executorDepthLimited
              ? 'not analyzed (depth limit)'
              : 'unknown'
      )
    );
    return rows;
  }
  if (report.type === 'zeroex') {
    const payload = report.payload;
    const rows = [
      row('variant', payload.variant),
      row('signature', payload.signature),
    ];
    if (payload.inputToken) {
      rows.push(
        row(
          'inputToken',
          `${payload.inputToken}${payload.inputIsEth ? ' (native ETH)' : ''}`
        )
      );
    }
    if (payload.outputToken) {
      rows.push(
        row(
          'outputToken',
          `${payload.outputToken}${payload.outputIsEth ? ' (native ETH)' : ''}`
        )
      );
    }
    if (payload.inputTokenAmount != null) {
      rows.push(row('amount', payload.inputTokenAmount));
    }
    if (payload.minOutputTokenAmount != null) {
      rows.push(row('minReturn', payload.minOutputTokenAmount));
    }
    if (payload.signer) rows.push(row('signer', payload.signer));
    if (payload.maker) rows.push(row('maker', payload.maker));
    if (payload.taker) rows.push(row('taker', payload.taker));
    if (payload.feeRecipient) {
      rows.push(row('feeRecipient', payload.feeRecipient));
    }
    if (payload.takerTokenFillAmount != null) {
      rows.push(row('fillAmount', payload.takerTokenFillAmount));
    }
    payload.transformations.forEach((item) => {
      rows.push(
        row(
          `transform ${item.index}`,
          `nonce=${item.deploymentNonce} type=${item.innerReport?.type ?? 'none'} risks=${(item.innerReport?.risks ?? []).join(',')}`
        )
      );
    });
    if (
      payload.variant === 'execute_meta_transaction' ||
      payload.variant === 'execute_meta_transaction_v2'
    ) {
      rows.push(
        row(
          'call data',
          payload.callReport
            ? `${payload.callReport.type} risks=${payload.callReport.risks.join(',')}`
            : payload.callData === '0x'
              ? 'none'
              : payload.callDepthLimited
                ? 'not analyzed (depth limit)'
                : 'unknown'
        )
      );
    }
    return rows;
  }
  if (report.type === 'cowswap') {
    const payload = report.payload;
    const rows = [
      row('variant', payload.variant),
      row('signature', payload.signature),
      row('tokens', String(payload.tokens.length)),
      row('trades', String(payload.trades.length)),
      row('interactions', String(payload.interactions.length)),
    ];
    if (payload.orderUid) rows.push(row('orderUid', payload.orderUid));
    if (payload.signed != null) {
      rows.push(row('signed', payload.signed ? 'yes' : 'no'));
    }
    payload.trades.forEach((item) => {
      rows.push(
        row(
          `trade ${item.index}`,
          `${item.kind} ${item.signingScheme} sell=${item.sellAmount} buy=${item.buyAmount} receiver=${item.receiverIsOwner ? 'owner' : item.receiver}`
        )
      );
    });
    payload.interactions.forEach((item) => {
      rows.push(
        row(
          `interaction ${item.index}`,
          `${item.stage} target=${item.target} value=${item.value} type=${item.innerReport?.type ?? 'none'} risks=${(item.innerReport?.risks ?? []).join(',')}`
        )
      );
    });
    return rows;
  }
  if (report.type === 'safe_exec') {
    const payload = report.payload;
    return [
      row('variant', payload.variant),
      row('signature', payload.signature),
      row('to', payload.to),
      row('operation', payload.operation),
      row('value', payload.value),
      row('targetKind', payload.targetKind),
      row(
        'targetLabel',
        payload.targetLabel
          ? `${payload.targetLabel.name} (${payload.targetLabel.kind})`
          : ''
      ),
      row(
        'signatures',
        payload.signatureCount == null
          ? 'n/a'
          : String(payload.signatureCount)
      ),
      row(
        'inner',
        payload.innerReport
          ? `${payload.innerReport.type} risks=${payload.innerReport.risks.join(',')}`
          : payload.data === '0x'
            ? 'native transfer'
            : payload.depthLimited
              ? 'not analyzed (depth limit)'
              : 'unknown'
      ),
    ];
  }
  if (report.type === 'eip7702') {
    const payload = report.payload;
    return [
      row('chainId', payload.chainId),
      row('nonce', payload.nonce),
      row('to', payload.to ?? ''),
      row('value', payload.value),
      row('authorizations', String(payload.authorizations.length)),
      ...payload.authorizations.map((item, index) =>
        row(
          `authorization ${index}`,
          `delegate=${item.address} chainId=${item.chainId} ${item.isRevocation ? 'revoke' : item.isAnyChain ? 'any-chain' : 'chain-bound'} kind=${item.delegateKind}${item.delegateLabel ? ` label=${item.delegateLabel.name}` : ''}`
        )
      ),
      row(
        'inner',
        payload.innerReport
          ? `${payload.innerReport.type} risks=${payload.innerReport.risks.join(',')}`
          : 'none'
      ),
    ];
  }
  if (report.type === 'erc4337_userop') {
    const payload = report.payload;
    const rows = [
      row('version', payload.version),
      row('beneficiary', payload.beneficiary),
      row('ops', String(payload.ops.length)),
    ];
    payload.ops.forEach((op, opIndex) => {
      rows.push(
        row(
          `op ${opIndex}`,
          `sender=${op.sender} nonce=${op.nonce} paymaster=${op.paymaster ?? 'none'}`
        )
      );
      op.calls.forEach((call, callIndex) => {
        rows.push(
          row(
            `op ${opIndex} call ${callIndex}`,
            `target=${call.target ?? 'callData'} value=${call.value} type=${call.report?.type ?? 'unknown'} risks=${(call.report?.risks ?? []).join(',')}`
          )
        );
      });
    });
    return rows;
  }
  if (report.type === 'plugin_decode') {
    const { pluginId, chain, summary, fields } = report.payload;
    return [
      row('plugin', pluginId),
      row('chain', chain),
      row('summary', summary),
      ...Object.entries(fields).map(([key, value]) =>
        row(key, formatValue(value))
      ),
    ];
  }
  if (report.type === 'solana_tx') {
    const payload = report.payload;
    return [
      row('version', String(payload.version)),
      row('feePayer', payload.feePayer ?? ''),
      row('recentBlockhash', payload.recentBlockhash),
      row('signatures', String(payload.signatures.length)),
      row('accountKeys', payload.accountKeys.join(', ')),
      ...payload.instructions.map((ix, index) =>
        row(
          `instruction ${index}`,
          `${ix.programId} accounts=[${ix.accounts.join(', ')}] data=${ix.dataHex}`
        )
      ),
      ...payload.addressTableLookups.map((lookup, index) =>
        row(
          `lookup ${index}`,
          `${lookup.accountKey} writable=[${lookup.writableIndexes.join(',')}] readonly=[${lookup.readonlyIndexes.join(',')}]`
        )
      ),
      ...payload.associatedTokenAccounts.map((ata) =>
        row(`ata ${ata.instructionIndex}`, formatAtaLine(ata))
      ),
      ...payload.splTokenInstructions.map((spl) =>
        row(`spl ${spl.instructionIndex}`, formatSplTokenLine(spl))
      ),
      ...payload.suspiciousCpi.map((hit) =>
        row(`cpi ${hit.instructionIndex}`, formatCpiLine(hit))
      ),
    ];
  }
  return Object.entries(report.payload).map(([key, value]) =>
    row(key, formatValue(value))
  );
}

function simulationItems(sim: SimulationSnapshot): string[] {
  const items: string[] = [];
  for (const b of sim.balances) {
    items.push(`Balance delta (${b.account}): ${b.delta}`);
  }
  for (const a of sim.allowances) {
    const parts = [`Allowance ${a.mode} ${a.owner} -> ${a.spender}`];
    if (a.delta !== null) parts.push(`delta ${a.delta}`);
    if (a.newValue !== null) parts.push(`new value ${a.newValue}`);
    if (a.wouldRevert) parts.push('would revert');
    items.push(parts.join(', '));
  }
  for (const o of sim.operators) {
    items.push(`Operator (${o.operator}): ${o.approved ? 'granted' : 'revoked'}`);
  }
  for (const note of sim.notes) items.push(`Note: ${note}`);
  return items;
}

const STYLE = [
  'body{font-family:system-ui,sans-serif;max-width:760px;margin:2rem auto;padding:0 1rem;color:#1b1b1b}',
  'table{border-collapse:collapse;width:100%}',
  'th,td{border:1px solid #ddd;padding:.4rem .6rem;text-align:left;vertical-align:top;word-break:break-all}',
  'th{background:#f6f6f6;width:30%}',
  '.sev{display:inline-block;padding:.1rem .5rem;border-radius:4px;color:#fff;font-weight:600}',
  '.sev-info{background:#2f6fb3}.sev-warn{background:#b7791f}.sev-high{background:#c53030}',
].join('');

export type HtmlReportExtras = {
  /**
   * Trusted markup inserted at the start of `<body>`. Callers must
   * HTML-escape any untrusted text before putting it here.
   */
  preambleHtml?: string;
};

/**
 * Render a JSON report as one self-contained HTML page: no scripts, no
 * external assets, and every dynamic value HTML-escaped.
 */
export function renderHtmlReport(
  report: JsonReport,
  title = 'tx-sim-risk report',
  extras?: HtmlReportExtras
): string {
  const sev = report.severity;
  const risks =
    report.riskDetails.length === 0
      ? '<p>No risks found.</p>'
      : `<ul>${report.riskDetails
          .map(
            (d) =>
              `<li><span class="sev sev-${d.severity}">${d.severity}</span> <code>${escapeHtml(d.id)}</code>: ${escapeHtml(d.reason)}</li>`
          )
          .join('')}</ul>`;
  const sim = simulationItems(report.simulation);
  const simHtml =
    sim.length === 0
      ? '<p>No simulated changes.</p>'
      : `<ul>${sim.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ul>`;

  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)}</title>`,
    `<style>${STYLE}</style>`,
    '</head>',
    '<body>',
    extras?.preambleHtml ? extras.preambleHtml : '',
    `<h1>${escapeHtml(title)}</h1>`,
    `<p>Type: <code>${escapeHtml(report.type)}</code> &middot; Severity: <span class="sev sev-${sev}">${sev}</span></p>`,
    '<h2>Details</h2>',
    `<table>${payloadRows(report).join('')}</table>`,
    '<h2>Risks</h2>',
    risks,
    '<h2>Simulation</h2>',
    simHtml,
    report.liveCall
      ? `<h2>Live call</h2>\n<p>${escapeHtml(formatLiveCallLine(report.liveCall))}</p>`
      : '',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

function listOrNone(items: readonly string[]): string {
  if (items.length === 0) return '<p>None.</p>';
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
}

/** Standalone HTML page for a `--diff` comparison. */
export function renderHtmlTxDiff(
  diff: TxDiff,
  title = 'tx-sim-risk diff'
): string {
  const amountRows =
    diff.amountChanges.length === 0
      ? '<p>None.</p>'
      : `<table>${diff.amountChanges
          .map(
            (change) =>
              row(
                change.field,
                `${change.before ?? 'n/a'} -> ${change.after ?? 'n/a'}`
              )
          )
          .join('')}</table>`;
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)}</title>`,
    `<style>${STYLE}</style>`,
    '</head>',
    '<body>',
    `<h1>${escapeHtml(title)}</h1>`,
    `<p>Type: <code>${escapeHtml(diff.baseline.type ?? 'unknown')}</code> -> <code>${escapeHtml(diff.candidate.type ?? 'unknown')}</code> &middot; Severity: ${escapeHtml(diff.baseline.severity ?? 'n/a')} -> ${escapeHtml(diff.candidate.severity ?? 'n/a')}</p>`,
    '<h2>Added risks</h2>',
    listOrNone(diff.addedRisks),
    '<h2>Removed risks</h2>',
    listOrNone(diff.removedRisks),
    '<h2>Added addresses</h2>',
    listOrNone(diff.addedAddresses.map((hit) => `${hit.role} ${hit.address}`)),
    '<h2>Removed addresses</h2>',
    listOrNone(diff.removedAddresses.map((hit) => `${hit.role} ${hit.address}`)),
    '<h2>Amount changes</h2>',
    amountRows,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}
