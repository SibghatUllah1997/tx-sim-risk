import { describe, it, expect } from 'vitest';
import { decodeErc20Approve, isUnlimitedErc20Approval } from '../src';

function pad32Bytes(hexNoPrefix: string): string {
  return hexNoPrefix.padStart(64, '0');
}

describe('ERC-20 approve decoder', () => {
  it('decodes unlimited approval correctly', () => {
    const selector = '095ea7b3';
    const spender = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const spenderWord = pad32Bytes(`000000000000000000000000${spender}`);
    const amountWord = 'f'.repeat(64); // max uint256
    const data = `0x${selector}${spenderWord}${amountWord}`;

    const decoded = decodeErc20Approve(data)!;
    expect(decoded.method).toBe('erc20_approve');
    expect(decoded.spender).toBe(`0x${spender}`);
    expect(decoded.amount).toBe((1n << 256n) - 1n);
    expect(decoded.isUnlimitedApproval).toBe(true);
    expect(isUnlimitedErc20Approval(data)).toBe(true);
  });

  it('decodes finite approval correctly', () => {
    const selector = '095ea7b3';
    const spender = '1111111111111111111111111111111111111111';
    const spenderWord = pad32Bytes(`000000000000000000000000${spender}`);
    const amount = 1000n;
    const amountWord = pad32Bytes(amount.toString(16));
    const data = `0x${selector}${spenderWord}${amountWord}`;

    const decoded = decodeErc20Approve(data)!;
    expect(decoded.spender).toBe(`0x${spender}`);
    expect(decoded.amount).toBe(amount);
    expect(decoded.isUnlimitedApproval).toBe(false);
    expect(isUnlimitedErc20Approval(data)).toBe(false);
  });

  it('returns null for non-approve selector', () => {
    const selector = 'a9059cbb'; // transfer(address,uint256)
    const dummyWord = '0'.repeat(64);
    const data = `0x${selector}${dummyWord}${dummyWord}`;
    const decoded = decodeErc20Approve(data);
    expect(decoded).toBeNull();
  });

  it('throws on invalid hex', () => {
    expect(() => decodeErc20Approve('0xzzzz')).toThrowError(/invalid hex/i);
  });
});

