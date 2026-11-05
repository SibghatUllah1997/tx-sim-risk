import { describe, it, expect } from 'vitest';
import { CALLER_ACCOUNT } from '../src';
import { generateJsonReport } from '../src/report';

function pad32Bytes(hexNoPrefix: string): string {
  return hexNoPrefix.padStart(64, '0');
}

function encodeApprove(spenderNo0x: string, amountHex: string): string {
  return `0x095ea7b3${pad32Bytes(`000000000000000000000000${spenderNo0x}`)}${pad32Bytes(amountHex)}`;
}

function encodeTransfer(toNo0x: string, amountHex: string): string {
  return `0xa9059cbb${pad32Bytes(`000000000000000000000000${toNo0x}`)}${pad32Bytes(amountHex)}`;
}

function encodeIncrease(spenderNo0x: string, deltaHex: string): string {
  return `0x39509351${pad32Bytes(`000000000000000000000000${spenderNo0x}`)}${pad32Bytes(deltaHex)}`;
}

function encodeDecrease(spenderNo0x: string, deltaHex: string): string {
  return `0xa457c2d7${pad32Bytes(`000000000000000000000000${spenderNo0x}`)}${pad32Bytes(deltaHex)}`;
}

const SPENDER = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const TO = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const FROM = '0xcccccccccccccccccccccccccccccccccccccccc';

describe('JSON report simulation snapshot', () => {
  it('includes transfer balance deltas and honors --from via options.from', () => {
    const report = generateJsonReport(encodeTransfer(TO, '64'), {
      from: FROM,
    })!;
    expect(report.simulation.balances).toEqual([
      { account: FROM, delta: '-100' },
      { account: `0x${TO}`, delta: '100' },
    ]);
    expect(report.simulation.allowances).toEqual([]);
  });

  it('defaults the sender to caller when from is omitted', () => {
    const report = generateJsonReport(encodeTransfer(TO, '01'))!;
    expect(report.simulation.balances[0]!.account).toBe(CALLER_ACCOUNT);
  });

  it('includes approve allowance set and optional prior-allowance delta', () => {
    const bare = generateJsonReport(encodeApprove(SPENDER, '2a'))!;
    expect(bare.simulation.allowances[0]).toMatchObject({
      owner: CALLER_ACCOUNT,
      spender: `0x${SPENDER}`,
      mode: 'set',
      delta: null,
      newValue: '42',
    });

    const withPrior = generateJsonReport(encodeApprove(SPENDER, '2a'), {
      from: FROM,
      currentAllowance: 10n,
    })!;
    expect(withPrior.simulation.allowances[0]).toMatchObject({
      owner: FROM,
      delta: '32',
      newValue: '42',
    });
  });

  it('includes increase and decrease allowance deltas', () => {
    const inc = generateJsonReport(encodeIncrease(SPENDER, '07'), {
      currentAllowance: 10n,
    })!;
    expect(inc.simulation.allowances[0]).toMatchObject({
      mode: 'increase',
      delta: '7',
      newValue: '17',
      wouldRevert: false,
    });

    const dec = generateJsonReport(encodeDecrease(SPENDER, '07'), {
      currentAllowance: 3n,
    })!;
    expect(dec.simulation.allowances[0]!.wouldRevert).toBe(true);
    expect(dec.simulation.notes.length).toBeGreaterThan(0);
  });
});
