import { describe, it, expect } from 'vitest';
import {
  decodeErc1155SetApprovalForAll,
  isErc1155ApproveAll,
  erc1155ApproveAllRisks,
  ERC1155_APPROVE_ALL_RISK,
} from '../src';

function pad32Bytes(hexNoPrefix: string): string {
  return hexNoPrefix.padStart(64, '0');
}

function encodeSetApprovalForAll(operator: string, approved: boolean): string {
  const selector = 'a22cb465';
  const operatorWord = pad32Bytes(`000000000000000000000000${operator}`);
  const approvedWord = pad32Bytes(approved ? '1' : '0');
  return `0x${selector}${operatorWord}${approvedWord}`;
}

describe('ERC-1155 setApprovalForAll decoder', () => {
  it('decodes an operator grant (approved = true)', () => {
    const operator = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
    const data = encodeSetApprovalForAll(operator, true);

    const decoded = decodeErc1155SetApprovalForAll(data)!;
    expect(decoded.method).toBe('erc1155_setApprovalForAll');
    expect(decoded.operator).toBe(`0x${operator}`);
    expect(decoded.approved).toBe(true);
    expect(decoded.isApproveAll).toBe(true);
  });

  it('decodes an operator revocation (approved = false)', () => {
    const operator = 'ffffffffffffffffffffffffffffffffffffffff';
    const data = encodeSetApprovalForAll(operator, false);

    const decoded = decodeErc1155SetApprovalForAll(data)!;
    expect(decoded.operator).toBe(`0x${operator}`);
    expect(decoded.approved).toBe(false);
    expect(decoded.isApproveAll).toBe(false);
  });

  it('returns null for a non-matching selector', () => {
    const selector = 'a9059cbb'; // transfer(address,uint256)
    const dummyWord = '0'.repeat(64);
    const data = `0x${selector}${dummyWord}${dummyWord}`;
    expect(decodeErc1155SetApprovalForAll(data)).toBeNull();
  });

  it('throws on invalid hex', () => {
    expect(() => decodeErc1155SetApprovalForAll('0xzzzz')).toThrowError(
      /invalid hex/i
    );
  });
});

describe('ERC-1155 approve-all risk', () => {
  it('flags an operator grant as approve-all', () => {
    const operator = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
    const data = encodeSetApprovalForAll(operator, true);
    expect(isErc1155ApproveAll(data)).toBe(true);
    expect(erc1155ApproveAllRisks(data)).toEqual([ERC1155_APPROVE_ALL_RISK]);
  });

  it('does not flag a revocation as approve-all', () => {
    const operator = 'ffffffffffffffffffffffffffffffffffffffff';
    const data = encodeSetApprovalForAll(operator, false);
    expect(isErc1155ApproveAll(data)).toBe(false);
    expect(erc1155ApproveAllRisks(data)).toEqual([]);
  });

  it('returns no risk for unrelated calldata', () => {
    const selector = '095ea7b3'; // approve(address,uint256)
    const dummyWord = '0'.repeat(64);
    const data = `0x${selector}${dummyWord}${dummyWord}`;
    expect(isErc1155ApproveAll(data)).toBe(false);
    expect(erc1155ApproveAllRisks(data)).toEqual([]);
  });
});
