import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  decodeErc20Approve,
  decodeErc20Transfer,
} from '../src';
import {
  decodeErc20IncreaseAllowance,
  decodeErc20DecreaseAllowance,
} from '../src/evm/allowance';

function pad32(hexNoPrefix: string): string {
  return hexNoPrefix.padStart(64, '0');
}

const addressArb = fc
  .array(fc.hexaString({ minLength: 1, maxLength: 2 }), { minLength: 20, maxLength: 20 })
  .map((pairs) => pairs.map((p) => (p.length === 1 ? '0' + p : p)).join('').slice(0, 40))
  .map((addr) => addr.toLowerCase());

const uint256HexArb = fc.bigUintN(256).map((n) => n.toString(16));

describe('Property-based: ERC-20 decoders', () => {
  it('approve round-trips spender and amount', () => {
    fc.assert(
      fc.property(addressArb, uint256HexArb, (spenderHex, amountHex) => {
        const selector = '095ea7b3';
        const spenderWord = pad32('0'.repeat(24) + spenderHex);
        const amountWord = pad32(amountHex);
        const data = `0x${selector}${spenderWord}${amountWord}`;
        const decoded = decodeErc20Approve(data)!;
        expect(decoded).not.toBeNull();
        expect(decoded.spender.toLowerCase()).toBe(`0x${spenderHex}`);
        expect(decoded.amount).toBe(BigInt('0x' + pad32(amountHex)));
      }),
      { numRuns: 50 },
    );
  });

  it('transfer round-trips to and amount', () => {
    fc.assert(
      fc.property(addressArb, uint256HexArb, (toHex, amountHex) => {
        const selector = 'a9059cbb';
        const toWord = pad32('0'.repeat(24) + toHex);
        const amountWord = pad32(amountHex);
        const data = `0x${selector}${toWord}${amountWord}`;
        const decoded = decodeErc20Transfer(data)!;
        expect(decoded).not.toBeNull();
        expect(decoded.to.toLowerCase()).toBe(`0x${toHex}`);
        expect(decoded.amount).toBe(BigInt('0x' + pad32(amountHex)));
      }),
      { numRuns: 50 },
    );
  });

  it('increase/decreaseAllowance round-trip spender and delta', () => {
    fc.assert(
      fc.property(addressArb, uint256HexArb, (spenderHex, deltaHex) => {
        // increaseAllowance
        const incSel = '39509351';
        const spenderWord = pad32('0'.repeat(24) + spenderHex);
        const deltaWord = pad32(deltaHex);
        const incData = `0x${incSel}${spenderWord}${deltaWord}`;
        const inc = decodeErc20IncreaseAllowance(incData)!;
        expect(inc).not.toBeNull();
        expect(inc.spender.toLowerCase()).toBe(`0x${spenderHex}`);
        expect(inc.amountDelta).toBe(BigInt('0x' + pad32(deltaHex)));

        // decreaseAllowance
        const decSel = 'a457c2d7';
        const decData = `0x${decSel}${spenderWord}${deltaWord}`;
        const dec = decodeErc20DecreaseAllowance(decData)!;
        expect(dec).not.toBeNull();
        expect(dec.spender.toLowerCase()).toBe(`0x${spenderHex}`);
        expect(dec.amountDelta).toBe(BigInt('0x' + pad32(deltaHex)));
      }),
      { numRuns: 50 },
    );
  });

  it('rejects clearly invalid hex payloads', () => {
    fc.assert(
      fc.property(
        fc
          .string({ minLength: 1, maxLength: 32 })
          .filter((s) => /[^0-9a-fA-F]/.test(s)), // ensure non-hex chars are present
        (s) => {
          expect(() => decodeErc20Approve('0x' + s)).toThrow();
          expect(() => decodeErc20Transfer('0x' + s)).toThrow();
        },
      ),
      { numRuns: 30 },
    );
  });
});

