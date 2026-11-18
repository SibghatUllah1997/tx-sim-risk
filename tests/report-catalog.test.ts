import { describe, expect, it } from 'vitest';
import {
  createCatalogIndex,
  formatReportFooter,
  generateJsonReport,
  isValidReport,
} from '../src';

const ROUTER = '7a250d5630b4cf539739df2c5dacb4c659f2488d';
const WETH = 'c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
const UNKNOWN = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function word(hexNoPrefix: string): string {
  return hexNoPrefix.padStart(64, '0');
}

function approve(spenderNo0x: string, amountHex: string): string {
  return `0x095ea7b3${word(`000000000000000000000000${spenderNo0x}`)}${word(amountHex)}`;
}

function transfer(toNo0x: string, amountHex: string): string {
  return `0xa9059cbb${word(`000000000000000000000000${toNo0x}`)}${word(amountHex)}`;
}

describe('catalog labels on reports', () => {
  it('names a known router spender and leaves unknown spenders unlabelled', () => {
    const named = generateJsonReport(approve(ROUTER, '64'))!;
    expect(named.type).toBe('erc20_approve');
    if (named.type !== 'erc20_approve') return;
    expect(named.payload.spenderLabel).toEqual({
      name: 'Uniswap V2 Router',
      kind: 'router',
    });
    expect(formatReportFooter(named)).toContain(
      'Spender label: Uniswap V2 Router (router)'
    );
    expect(isValidReport(named)).toBe(true);

    const unknown = generateJsonReport(approve(UNKNOWN, '64'))!;
    if (unknown.type !== 'erc20_approve') return;
    expect(unknown.payload.spenderLabel).toBeNull();
    expect(formatReportFooter(unknown).join('\n')).not.toMatch(/Spender label:/);
  });

  it('labels token recipients and honors a catalog override', () => {
    const sent = generateJsonReport(transfer(WETH, '0a'))!;
    expect(sent.type).toBe('erc20_transfer');
    if (sent.type !== 'erc20_transfer') return;
    expect(sent.payload.toLabel).toEqual({
      name: 'Wrapped Ether',
      kind: 'token',
    });
    expect(isValidReport(sent)).toBe(true);

    const catalog = createCatalogIndex([
      { address: `0x${UNKNOWN}`, name: 'Test Bridge', kind: 'bridge' },
    ]);
    const report = generateJsonReport(approve(UNKNOWN, '1'), { catalog })!;
    if (report.type !== 'erc20_approve') return;
    expect(report.payload.spenderLabel).toEqual({
      name: 'Test Bridge',
      kind: 'bridge',
    });
    const overridden = generateJsonReport(approve(ROUTER, '1'), { catalog })!;
    if (overridden.type !== 'erc20_approve') return;
    expect(overridden.payload.spenderLabel).toBeNull();
  });
});
