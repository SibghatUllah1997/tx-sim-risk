import { describe, it, expect } from 'vitest';
import { decodeErc20Transfer } from '../src';

function pad32Bytes(hexNoPrefix: string): string {
  return hexNoPrefix.padStart(64, '0');
}

describe('ERC-20 transfer decoder', () => {
  it('decodes transfer correctly', () => {
    const selector = 'a9059cbb';
    const to = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const toWord = pad32Bytes(`000000000000000000000000${to}`);
    const amount = 1234567890123456789n;
    const amountWord = pad32Bytes(amount.toString(16));
    const data = `0x${selector}${toWord}${amountWord}`;

    const decoded = decodeErc20Transfer(data)!;
    expect(decoded.method).toBe('erc20_transfer');
    expect(decoded.to).toBe(`0x${to}`);
    expect(decoded.amount).toBe(amount);
    expect(decoded.isToZeroAddress).toBe(false);
  });

  it('returns null for non-transfer selector', () => {
    const selector = '095ea7b3'; // approve(address,uint256)
    const dummyWord = '0'.repeat(64);
    const data = `0x${selector}${dummyWord}${dummyWord}`;
    const decoded = decodeErc20Transfer(data);
    expect(decoded).toBeNull();
  });

  it('throws on invalid hex', () => {
    expect(() => decodeErc20Transfer('0xzzzz')).toThrowError(/invalid hex/i);
  });

  it('throws when the transfer selector is present but arguments are truncated', () => {
    expect(() => decodeErc20Transfer('0xa9059cbb' + '00'.repeat(20))).toThrowError(
      /data too short for transfer/i
    );
  });

  it('flags transfer to zero address as a burn risk', () => {
    const selector = 'a9059cbb';
    const zero = '0'.repeat(40);
    const toWord = pad32Bytes(`000000000000000000000000${zero}`);
    const amount = 1n;
    const amountWord = pad32Bytes(amount.toString(16));
    const data = `0x${selector}${toWord}${amountWord}`;

    const decoded = decodeErc20Transfer(data)!;
    expect(decoded.isToZeroAddress).toBe(true);
  });
});

