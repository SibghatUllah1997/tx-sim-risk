import { describe, it, expect } from 'vitest';
import {
  decodeErc20IncreaseAllowance,
  decodeErc20DecreaseAllowance,
} from '../src/evm/allowance';

function pad32Bytes(hexNoPrefix: string): string {
  return hexNoPrefix.padStart(64, '0');
}

describe('ERC-20 increase/decrease allowance decoders', () => {
  it('decodes increaseAllowance correctly', () => {
    const selector = '39509351';
    const spender = '2222222222222222222222222222222222222222';
    const spenderWord = pad32Bytes(`000000000000000000000000${spender}`);
    const delta = 42n;
    const deltaWord = pad32Bytes(delta.toString(16));
    const data = `0x${selector}${spenderWord}${deltaWord}`;

    const decoded = decodeErc20IncreaseAllowance(data)!;
    expect(decoded.method).toBe('erc20_increaseAllowance');
    expect(decoded.spender).toBe(`0x${spender}`);
    expect(decoded.amountDelta).toBe(delta);
  });

  it('decodes decreaseAllowance correctly', () => {
    const selector = 'a457c2d7';
    const spender = '3333333333333333333333333333333333333333';
    const spenderWord = pad32Bytes(`000000000000000000000000${spender}`);
    const delta = 7n;
    const deltaWord = pad32Bytes(delta.toString(16));
    const data = `0x${selector}${spenderWord}${deltaWord}`;

    const decoded = decodeErc20DecreaseAllowance(data)!;
    expect(decoded.method).toBe('erc20_decreaseAllowance');
    expect(decoded.spender).toBe(`0x${spender}`);
    expect(decoded.amountDelta).toBe(delta);
  });

  it('returns null for non-increase selector', () => {
    const selector = '095ea7b3'; // approve
    const dummyWord = '0'.repeat(64);
    const data = `0x${selector}${dummyWord}${dummyWord}`;
    const decoded = decodeErc20IncreaseAllowance(data);
    expect(decoded).toBeNull();
  });

  it('returns null for non-decrease selector', () => {
    const selector = 'a9059cbb'; // transfer
    const dummyWord = '0'.repeat(64);
    const data = `0x${selector}${dummyWord}${dummyWord}`;
    const decoded = decodeErc20DecreaseAllowance(data);
    expect(decoded).toBeNull();
  });

  it('throws on invalid hex', () => {
    expect(() => decodeErc20IncreaseAllowance('0xzzzz')).toThrowError(
      /invalid hex/i
    );
    expect(() => decodeErc20DecreaseAllowance('0xzzzz')).toThrowError(
      /invalid hex/i
    );
  });

  it('throws when a matching selector has truncated arguments', () => {
    expect(() =>
      decodeErc20IncreaseAllowance('0x39509351' + '00'.repeat(20))
    ).toThrowError(/data too short for increaseAllowance/i);
    expect(() =>
      decodeErc20DecreaseAllowance('0xa457c2d7' + '00'.repeat(20))
    ).toThrowError(/data too short for decreaseAllowance/i);
  });
});

