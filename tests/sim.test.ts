import { describe, it, expect } from 'vitest';
import {
  CALLER_ACCOUNT,
  emptySimulation,
  simulateCalldata,
} from '../src/sim';

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

function encodeSetApprovalForAll(
  operatorNo0x: string,
  approved: boolean
): string {
  return `0xa22cb465${pad32Bytes(`000000000000000000000000${operatorNo0x}`)}${pad32Bytes(approved ? '1' : '0')}`;
}

const SPENDER = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const RECIPIENT = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const FROM = '0xcccccccccccccccccccccccccccccccccccccccc';

describe('simulation stub', () => {
  it('returns an empty snapshot helper', () => {
    expect(emptySimulation()).toEqual({
      balances: [],
      allowances: [],
      operators: [],
      notes: [],
    });
  });

  it('returns null for unknown selectors', () => {
    expect(simulateCalldata('0xdeadbeef')).toBeNull();
  });

  it('moves transfer amount from the caller to the recipient', () => {
    const sim = simulateCalldata(encodeTransfer(RECIPIENT, '64'))!;
    expect(sim.balances).toEqual([
      { account: CALLER_ACCOUNT, delta: '-100' },
      { account: `0x${RECIPIENT}`, delta: '100' },
    ]);
    expect(sim.allowances).toEqual([]);
  });

  it('uses a supplied from address as the transfer sender', () => {
    const sim = simulateCalldata(encodeTransfer(RECIPIENT, '0a'), {
      from: FROM,
    })!;
    expect(sim.balances[0]).toEqual({ account: FROM, delta: '-10' });
    expect(sim.balances[1]!.account).toBe(`0x${RECIPIENT}`);
  });

  it('rejects an invalid from address', () => {
    expect(() =>
      simulateCalldata(encodeTransfer(RECIPIENT, '1'), { from: '0x1234' })
    ).toThrow(/Invalid from address/);
  });

  it('treats approve as an absolute allowance set', () => {
    const sim = simulateCalldata(encodeApprove(SPENDER, '2a'))!;
    expect(sim.allowances).toEqual([
      {
        owner: CALLER_ACCOUNT,
        spender: `0x${SPENDER}`,
        mode: 'set',
        delta: null,
        newValue: '42',
        wouldRevert: false,
      },
    ]);
  });

  it('computes the approve delta when a prior allowance is known', () => {
    const sim = simulateCalldata(encodeApprove(SPENDER, '64'), {
      from: FROM,
      currentAllowance: 40n,
    })!;
    expect(sim.allowances[0]).toMatchObject({
      owner: FROM,
      mode: 'set',
      delta: '60',
      newValue: '100',
      wouldRevert: false,
    });
  });

  it('adds increaseAllowance when no prior value is known', () => {
    const sim = simulateCalldata(encodeIncrease(SPENDER, '07'))!;
    expect(sim.allowances[0]).toMatchObject({
      mode: 'increase',
      delta: '7',
      newValue: null,
      wouldRevert: false,
    });
    expect(sim.notes).toEqual([]);
  });

  it('computes the new allowance after increaseAllowance', () => {
    const sim = simulateCalldata(encodeIncrease(SPENDER, '07'), {
      currentAllowance: 10n,
    })!;
    expect(sim.allowances[0]).toMatchObject({
      delta: '7',
      newValue: '17',
      wouldRevert: false,
    });
  });

  it('flags increaseAllowance overflow past uint256', () => {
    const sim = simulateCalldata(encodeIncrease(SPENDER, '1'), {
      currentAllowance: (1n << 256n) - 1n,
    })!;
    expect(sim.allowances[0]!.wouldRevert).toBe(true);
    expect(sim.allowances[0]!.newValue).toBeNull();
    expect(sim.notes[0]).toMatch(/exceeds uint256/);
  });

  it('subtracts decreaseAllowance and flags underflow', () => {
    const ok = simulateCalldata(encodeDecrease(SPENDER, '07'), {
      currentAllowance: 10n,
    })!;
    expect(ok.allowances[0]).toMatchObject({
      mode: 'decrease',
      delta: '-7',
      newValue: '3',
      wouldRevert: false,
    });

    const revert = simulateCalldata(encodeDecrease(SPENDER, '07'), {
      currentAllowance: 3n,
    })!;
    expect(revert.allowances[0]!.wouldRevert).toBe(true);
    expect(revert.allowances[0]!.newValue).toBeNull();
    expect(revert.notes[0]).toMatch(/smaller than the subtracted amount/);
  });

  it('records NFT operator grants and revocations', () => {
    const grant = simulateCalldata(encodeSetApprovalForAll(SPENDER, true))!;
    expect(grant.operators).toEqual([
      { operator: `0x${SPENDER}`, approved: true },
    ]);
    const revoke = simulateCalldata(encodeSetApprovalForAll(SPENDER, false))!;
    expect(revoke.operators).toEqual([
      { operator: `0x${SPENDER}`, approved: false },
    ]);
  });

  it('rejects a currentAllowance outside uint256', () => {
    expect(() =>
      simulateCalldata(encodeApprove(SPENDER, '1'), { currentAllowance: -1n })
    ).toThrow(/uint256/);
  });
});
