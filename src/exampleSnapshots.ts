import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
  loadDataset,
  reportOptionsForCase,
  type DatasetCase,
} from './dataset';
import { generateJsonReportFromAny, type JsonReport } from './report';
import { formatPlainTextReport } from './textReport';

/** Dataset case ids used for README terminal screenshots. Keep this short. */
export const SNAPSHOT_CASE_IDS = [
  'erc20-unlimited-approve',
  'erc20-burn-transfer',
  'solana-drainer-invoke',
] as const;

export type SnapshotCaseId = (typeof SNAPSHOT_CASE_IDS)[number];

export type ExampleSnapshot = {
  id: SnapshotCaseId;
  description: string;
  /** Prompt shown in the window chrome. */
  command: string;
  /** Plain-text CLI analysis (no ANSI). */
  text: string;
  /** SVG terminal screenshot of `text`. */
  svg: string;
};

const XML_ESCAPES: Readonly<Record<string, string>> = Object.freeze({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
});

function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => XML_ESCAPES[ch]!);
}

/** CLI-style analysis lines for a decoded report. */
export function cliTextForReport(report: JsonReport): string {
  return formatPlainTextReport(report).join('\n');
}

function wrapLine(line: string, width: number): string[] {
  if (line.length <= width) return [line];
  const parts: string[] = [];
  for (let i = 0; i < line.length; i += width) {
    parts.push(line.slice(i, i + width));
  }
  return parts;
}

function fillForLine(line: string): string {
  if (line.startsWith('Severity: high') || line.startsWith('Risks:')) {
    return '#f44747';
  }
  if (line.startsWith('Severity: warn')) return '#d7ba7d';
  if (line.startsWith('Detected:')) return '#9cdcfe';
  return '#d4d4d4';
}

/**
 * Draw a script-free SVG of a terminal window containing `lines`.
 * Used as README screenshots; the text is the same as `cliTextForReport`.
 */
export function renderTerminalSvg(
  title: string,
  body: string,
  wrapAt = 88
): string {
  const lines = body.split('\n').flatMap((line) => wrapLine(line, wrapAt));
  const charWidth = 7.2;
  const lineHeight = 18;
  const padX = 16;
  const padY = 14;
  const chrome = 36;
  const contentWidth = Math.max(
    title.length + 8,
    ...lines.map((line) => line.length),
    40
  );
  const width = Math.ceil(padX * 2 + contentWidth * charWidth);
  const height = chrome + padY * 2 + lines.length * lineHeight;
  const text = lines
    .map((line, i) => {
      const y = chrome + padY + (i + 1) * lineHeight - 4;
      return `<text x="${padX}" y="${y}" fill="${fillForLine(line)}" font-family="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" font-size="12">${escapeXml(line)}</text>`;
    })
    .join('');
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(title)}">`,
    `<rect width="${width}" height="${height}" rx="8" fill="#1e1e1e"/>`,
    `<rect width="${width}" height="${chrome}" rx="8" fill="#2d2d2d"/>`,
    `<rect y="20" width="${width}" height="${chrome - 20}" fill="#2d2d2d"/>`,
    `<circle cx="18" cy="18" r="5" fill="#ff5f56"/>`,
    `<circle cx="36" cy="18" r="5" fill="#ffbd2e"/>`,
    `<circle cx="54" cy="18" r="5" fill="#27c93f"/>`,
    `<text x="74" y="22" fill="#9e9e9e" font-family="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" font-size="11">${escapeXml(title)}</text>`,
    text,
    `</svg>\n`,
  ].join('');
}

function snapshotCommand(c: DatasetCase): string {
  const bits = ['tx-sim-risk'];
  if (c.from) bits.push('--from', c.from);
  if (c.config) bits.push('--config', 'examples/risk-lists.json');
  bits.push(`# ${c.id}`);
  return bits.join(' ');
}

function snapshotFor(
  c: DatasetCase,
  baseDir: string
): ExampleSnapshot {
  const report = generateJsonReportFromAny(
    c.input,
    reportOptionsForCase(c, baseDir)
  );
  if (!report) {
    throw new Error(`Snapshot case "${c.id}" did not decode`);
  }
  const text = cliTextForReport(report);
  const id = c.id as SnapshotCaseId;
  return {
    id,
    description: c.description,
    command: snapshotCommand(c),
    text: `${text}\n`,
    svg: renderTerminalSvg(snapshotCommand(c), text),
  };
}

/** Build README screenshots from the labelled example dataset. */
export function buildExampleSnapshots(
  datasetPath: string,
  ids: readonly SnapshotCaseId[] = SNAPSHOT_CASE_IDS
): ExampleSnapshot[] {
  const dataset = loadDataset(datasetPath);
  const baseDir = dirname(resolve(datasetPath));
  return ids.map((id) => {
    const c = dataset.cases.find((entry) => entry.id === id);
    if (!c) throw new Error(`Dataset is missing snapshot case "${id}"`);
    return snapshotFor(c, baseDir);
  });
}

/** Write `<id>.txt` and `<id>.svg` for each snapshot into `outDir`. */
export function writeExampleDocs(
  datasetPath: string,
  outDir: string,
  ids: readonly SnapshotCaseId[] = SNAPSHOT_CASE_IDS
): string[] {
  mkdirSync(outDir, { recursive: true });
  const names: string[] = [];
  for (const snap of buildExampleSnapshots(datasetPath, ids)) {
    const txt = `${snap.id}.txt`;
    const svg = `${snap.id}.svg`;
    writeFileSync(join(outDir, txt), snap.text);
    writeFileSync(join(outDir, svg), snap.svg);
    names.push(txt, svg);
  }
  return names;
}
