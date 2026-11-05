import { describe, it, expect } from 'vitest';
import { encodeFunctionData, parseAbi } from 'viem';
import { formatReportFooter, generateJsonReport } from '../src/report';

const A = '0x' + 'aa'.repeat(20);
const B = '0x' + 'bb'.repeat(20);

const transferFromAbi = parseAbi([
  'function transferFrom(address from, address to, uint256 value)',
]);

describe('generic ABI report fallback', () => {
  it('reports transferFrom as abi_call with decoded args', () => {
    const data = encodeFunctionData({
      abi: transferFromAbi,
      functionName: 'transferFrom',
      args: [A, B, 500n],
    });
    const report = generateJsonReport(data);
    expect(report?.type).toBe('abi_call');
    if (report?.type !== 'abi_call') return;
    expect(report.payload.signature).toBe(
      'transferFrom(address,address,uint256)'
    );
    expect(report.payload.standards).toEqual(['erc20', 'erc721']);
    expect(report.payload.args.map((arg) => arg.value)).toEqual([A, B, '500']);
    expect(report.risks).toEqual([]);
    expect(report.simulation.balances).toEqual([]);
  });

  it('is JSON-serialisable (no bigint values)', () => {
    const data = encodeFunctionData({
      abi: transferFromAbi,
      functionName: 'transferFrom',
      args: [A, B, (1n << 255n) + 1n],
    });
    const report = generateJsonReport(data)!;
    expect(() => JSON.stringify(report)).not.toThrow();
  });

  it('adds a standards line to the CLI footer', () => {
    const data = encodeFunctionData({
      abi: transferFromAbi,
      functionName: 'transferFrom',
      args: [A, B, 1n],
    });
    const lines = formatReportFooter(generateJsonReport(data)!);
    expect(lines).toContain('Standards: erc20, erc721');
  });

  it('keeps dedicated reports ahead of the generic path', () => {
    const data = `0xa9059cbb${'bb'.repeat(20).padStart(64, '0')}${'1'.padStart(64, '0')}`;
    expect(generateJsonReport(data)?.type).toBe('erc20_transfer');
  });

  it('still returns null for unknown selectors', () => {
    expect(generateJsonReport('0xdeadbeef')).toBeNull();
  });
});
