import { describe, expect, it } from 'vitest';
import {
  LIVE_CALL_REVERTED_RISK,
  UNLIMITED_APPROVAL_RISK,
  generateJsonReport,
  renderHtmlReport,
  withLiveCall,
  type LiveCallResult,
} from '../src';
import { loadReportSchema } from '../src/schema';
import { assertValidReport, isValidReport } from '../src/schemaValidate';
import { formatPlainTextReport } from '../src/textReport';
import { approveCalldata, MAX_UINT, ROUTER } from './e2e/fixtures';

const schema = loadReportSchema();
const TOKEN = `0x${'cc'.repeat(20)}`;

function result(overrides: Partial<LiveCallResult>): LiveCallResult {
  return {
    status: 'success',
    to: TOKEN,
    from: null,
    value: '0',
    block: 'latest',
    chainId: '1',
    returnData: '0x',
    revertReason: null,
    error: null,
    ...overrides,
  };
}

function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe('withLiveCall', () => {
  const base = generateJsonReport(approveCalldata(ROUTER, '64'))!;

  it('attaches a successful call without changing risks or severity', () => {
    const report = withLiveCall(base, result({ returnData: `0x${'00'.repeat(31)}01` }));
    expect(report.risks).toEqual(base.risks);
    expect(report.severity).toBe(base.severity);
    expect(report.simulation).toEqual(base.simulation);
    expect(report.liveCall?.status).toBe('success');
    assertValidReport(plain(report), schema);
    expect(base.liveCall).toBeUndefined();
  });

  it('adds live_call_reverted on a revert and keeps the higher severity', () => {
    const reverted = withLiveCall(base, result({ status: 'reverted', revertReason: 'paused', returnData: null }));
    expect(reverted.risks).toEqual([LIVE_CALL_REVERTED_RISK]);
    expect(reverted.severity).toBe('warn');
    expect(reverted.riskDetails.map((d) => d.id)).toEqual([LIVE_CALL_REVERTED_RISK]);

    const unlimited = generateJsonReport(approveCalldata(ROUTER, MAX_UINT))!;
    const both = withLiveCall(unlimited, result({ status: 'reverted' }));
    expect(both.risks).toEqual([UNLIMITED_APPROVAL_RISK, LIVE_CALL_REVERTED_RISK]);
    expect(both.severity).toBe('high');
    assertValidReport(plain(both), schema);
    expect(withLiveCall(both, result({ status: 'reverted' })).risks).toEqual(both.risks);
  });

  it('does not raise a risk when the RPC itself fails', () => {
    const report = withLiveCall(base, result({ status: 'error', chainId: null, returnData: null, error: 'timeout' }));
    expect(report.risks).toEqual([]);
    assertValidReport(plain(report), schema);
  });

  it('shows the outcome in text and HTML reports', () => {
    const report = withLiveCall(base, result({ status: 'reverted', revertReason: '<paused>' }));
    expect(formatPlainTextReport(report)).toContain('Live eth_call (block latest): reverted (<paused>)');
    const html = renderHtmlReport(report);
    expect(html).toContain('<h2>Live call</h2>');
    expect(html).toContain('reverted (&lt;paused&gt;)');
    expect(renderHtmlReport(base)).not.toContain('Live call');
  });

  it('schema rejects a malformed liveCall block', () => {
    const report = plain(withLiveCall(base, result({}))) as any;
    report.liveCall.status = 'maybe';
    expect(isValidReport(report, schema)).toBe(false);
    delete report.liveCall.status;
    expect(isValidReport(report, schema)).toBe(false);
  });
});
