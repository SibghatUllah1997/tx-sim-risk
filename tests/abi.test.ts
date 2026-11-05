import { describe, it, expect } from 'vitest';
import { encodeFunctionData, parseAbi } from 'viem';
import { decodeCommonAbi, knownAbiSignatures } from '../src/evm/abi';

const A = '0x' + 'aa'.repeat(20);
const B = '0x' + 'bb'.repeat(20);
const C = '0x' + 'cc'.repeat(20);

function word(hexNo0x: string): string {
  return hexNo0x.padStart(64, '0');
}

describe('decodeCommonAbi', () => {
  it('decodes ERC-20 transfer from hand-built calldata', () => {
    const data = `0xa9059cbb${word('bb'.repeat(20))}${word('3e8')}`;
    const decoded = decodeCommonAbi(data);
    expect(decoded).not.toBeNull();
    expect(decoded!.signature).toBe('transfer(address,uint256)');
    expect(decoded!.standards).toEqual(['erc20']);
    expect(decoded!.args).toEqual([
      { name: 'to', type: 'address', value: B },
      { name: 'value', type: 'uint256', value: '1000' },
    ]);
  });

  it('reports every standard that shares a selector', () => {
    const data = `0x095ea7b3${word('aa'.repeat(20))}${word('1')}`;
    const decoded = decodeCommonAbi(data);
    expect(decoded?.signature).toBe('approve(address,uint256)');
    expect(decoded?.standards).toEqual(['erc20', 'erc721']);
  });

  it('decodes setApprovalForAll for both NFT standards', () => {
    const data = `0xa22cb465${word('aa'.repeat(20))}${word('1')}`;
    const decoded = decodeCommonAbi(data);
    expect(decoded?.functionName).toBe('setApprovalForAll');
    expect(decoded?.standards).toEqual(['erc721', 'erc1155']);
    expect(decoded?.args[1]).toEqual({
      name: 'approved',
      type: 'bool',
      value: true,
    });
  });

  it('decodes ERC-721 safeTransferFrom with trailing bytes', () => {
    const abi = parseAbi([
      'function safeTransferFrom(address from, address to, uint256 tokenId, bytes data)',
    ]);
    const data = encodeFunctionData({
      abi,
      functionName: 'safeTransferFrom',
      args: [A, B, 7n, '0xdeadbeef'],
    });
    const decoded = decodeCommonAbi(data);
    expect(decoded?.signature).toBe(
      'safeTransferFrom(address,address,uint256,bytes)'
    );
    expect(decoded?.standards).toEqual(['erc721']);
    expect(decoded?.args.map((arg) => arg.value)).toEqual([
      A,
      B,
      '7',
      '0xdeadbeef',
    ]);
  });

  it('decodes ERC-1155 safeBatchTransferFrom with array arguments', () => {
    const abi = parseAbi([
      'function safeBatchTransferFrom(address from, address to, uint256[] ids, uint256[] values, bytes data)',
    ]);
    const data = encodeFunctionData({
      abi,
      functionName: 'safeBatchTransferFrom',
      args: [A, B, [1n, 2n, 3n], [10n, 20n, 30n], '0x'],
    });
    const decoded = decodeCommonAbi(data);
    expect(decoded?.standards).toEqual(['erc1155']);
    expect(decoded?.args[2]).toEqual({
      name: 'ids',
      type: 'uint256[]',
      value: ['1', '2', '3'],
    });
    expect(decoded?.args[3]?.value).toEqual(['10', '20', '30']);
  });

  it('keeps uint256 values above 2^53 exact', () => {
    const max = (1n << 256n) - 1n;
    const data = encodeFunctionData({
      abi: parseAbi(['function transferFrom(address from, address to, uint256 value)']),
      functionName: 'transferFrom',
      args: [A, C, max],
    });
    const decoded = decodeCommonAbi(data);
    expect(decoded?.standards).toEqual(['erc20', 'erc721']);
    expect(decoded?.args[2]?.value).toBe(max.toString());
  });

  it('returns null for unknown selectors and short input', () => {
    expect(decodeCommonAbi('0xdeadbeef')).toBeNull();
    expect(decodeCommonAbi('0x')).toBeNull();
    expect(decodeCommonAbi('0x1234')).toBeNull();
  });

  it('throws on invalid hex', () => {
    expect(() => decodeCommonAbi('0xzz')).toThrow('Invalid hex data');
  });

  it('throws when a known selector has truncated arguments', () => {
    expect(() => decodeCommonAbi(`0xa9059cbb${word('bb'.repeat(20))}`)).toThrow(
      'Malformed arguments for transfer(address,uint256)'
    );
  });

  it('lists each canonical signature once', () => {
    const signatures = knownAbiSignatures();
    expect(new Set(signatures).size).toBe(signatures.length);
    expect(signatures).toContain('safeBatchTransferFrom(address,address,uint256[],uint256[],bytes)');
  });
});
