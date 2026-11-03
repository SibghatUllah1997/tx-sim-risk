import { describe, it, expect } from 'vitest';
import {
  decodeErc721SetApprovalForAll,
  decodeSetApprovalForAll,
  isErc721ApproveAll,
  erc721ApproveAllRisks,
  ERC721_APPROVE_ALL_RISK,
} from '../src';

function pad32Bytes(hexNoPrefix: string): string {
  return hexNoPrefix.padStart(64, '0');
}

function encodeSetApprovalForAll(
  operator: string,
  approved: boolean | string
): string {
  const selector = 'a22cb465';
  const operatorWord = pad32Bytes(`000000000000000000000000${operator}`);
  const approvedWord =
    typeof approved === 'string'
      ? pad32Bytes(approved)
      : pad32Bytes(approved ? '1' : '0');
  return `0x${selector}${operatorWord}${approvedWord}`;
}

describe('ERC-721 setApprovalForAll decoder', () => {
  it('decodes an operator grant (approved = true)', () => {
    const operator = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const data = encodeSetApprovalForAll(operator, true);

    const decoded = decodeErc721SetApprovalForAll(data)!;
    expect(decoded.method).toBe('erc721_setApprovalForAll');
    expect(decoded.operator).toBe(`0x${operator}`);
    expect(decoded.approved).toBe(true);
    expect(decoded.isApproveAll).toBe(true);

    const shared = decodeSetApprovalForAll(data)!;
    expect(shared.operator).toBe(`0x${operator}`);
    expect(shared.approved).toBe(true);
  });

  it('decodes an operator revocation (approved = false)', () => {
    const operator = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const data = encodeSetApprovalForAll(operator, false);

    const decoded = decodeErc721SetApprovalForAll(data)!;
    expect(decoded.operator).toBe(`0x${operator}`);
    expect(decoded.approved).toBe(false);
    expect(decoded.isApproveAll).toBe(false);
  });

  it('returns null for a non-matching selector', () => {
    const selector = '095ea7b3'; // approve(address,uint256)
    const dummyWord = '0'.repeat(64);
    const data = `0x${selector}${dummyWord}${dummyWord}`;
    expect(decodeErc721SetApprovalForAll(data)).toBeNull();
    expect(decodeSetApprovalForAll(data)).toBeNull();
  });

  it('throws on invalid hex', () => {
    expect(() => decodeErc721SetApprovalForAll('0xzzzz')).toThrowError(
      /invalid hex/i
    );
  });

  it('throws when calldata is too short for the ABI', () => {
    expect(() =>
      decodeErc721SetApprovalForAll('0xa22cb465' + '00'.repeat(31))
    ).toThrowError(/too short/i);
  });

  it('throws on a bool word that is not 0 or 1', () => {
    const operator = 'cccccccccccccccccccccccccccccccccccccccc';
    const data = encodeSetApprovalForAll(operator, '02');
    expect(() => decodeErc721SetApprovalForAll(data)).toThrowError(
      /invalid bool/i
    );
  });

  it('accepts mixed-case hex and extra trailing bytes', () => {
    const operator = 'dddddddddddddddddddddddddddddddddddddddd';
    const data = encodeSetApprovalForAll(operator, true).toUpperCase() + 'aabb';
    const decoded = decodeErc721SetApprovalForAll(data)!;
    expect(decoded.operator).toBe(`0x${operator}`);
    expect(decoded.approved).toBe(true);
  });
});

describe('ERC-721 approve-all risk', () => {
  it('flags an operator grant as approve-all', () => {
    const operator = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const data = encodeSetApprovalForAll(operator, true);
    expect(isErc721ApproveAll(data)).toBe(true);
    expect(erc721ApproveAllRisks(data)).toEqual([ERC721_APPROVE_ALL_RISK]);
  });

  it('does not flag a revocation as approve-all', () => {
    const operator = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const data = encodeSetApprovalForAll(operator, false);
    expect(isErc721ApproveAll(data)).toBe(false);
    expect(erc721ApproveAllRisks(data)).toEqual([]);
  });

  it('returns no risk for unrelated calldata', () => {
    const selector = 'a9059cbb'; // transfer(address,uint256)
    const dummyWord = '0'.repeat(64);
    const data = `0x${selector}${dummyWord}${dummyWord}`;
    expect(isErc721ApproveAll(data)).toBe(false);
    expect(erc721ApproveAllRisks(data)).toEqual([]);
  });
});
