import type { JsonReport } from './report';
import type { SimulationSnapshot } from './sim';

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
    '</body>',
    '</html>',
    '',
  ].join('\n');
}
