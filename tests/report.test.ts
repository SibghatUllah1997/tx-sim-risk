import { describe, it, expect } from 'vitest';
import { generateJsonReport } from '../src/report';

function pad32Bytes(hexNoPrefix: string): string {
  return hexNoPrefix.padStart(64, '0');
}

describe('JSON report generator', () => {
  it('reports unlimited approval with risk flag', () => {
    const selector = '095ea7b3'; // approve
    const spender = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const spenderWord = pad32Bytes(`000000000000000000000000${spender}`);
    const amountWord = 'f'.repeat(64); // max uint256
    const data = `0x${selector}${spenderWord}${amountWord}`;

    const report = generateJsonReport(data)!;
    expect(report.type).toBe('erc20_approve');
    expect(report.payload.spender).toBe(`0x${spender}`);
    expect(report.payload.isUnlimitedApproval).toBe(true);
    expect(report.risks).toContain('unlimited_approval');
  });

  it('reports transfer to zero with risk flag', () => {
    const selector = 'a9059cbb'; // transfer
    const zero = '0'.repeat(40);
    const toWord = pad32Bytes(`000000000000000000000000${zero}`);
    const amountWord = pad32Bytes('1');
    const data = `0x${selector}${toWord}${amountWord}`;

    const report = generateJsonReport(data)!;
    expect(report.type).toBe('erc20_transfer');
    expect(report.payload.isToZeroAddress).toBe(true);
    expect(report.risks).toContain('burn_to_zero_address');
  });

  it('reports increaseAllowance', () => {
    const selector = '39509351'; // increaseAllowance
    const spender = '2222222222222222222222222222222222222222';
    const spenderWord = pad32Bytes(`000000000000000000000000${spender}`);
    const deltaWord = pad32Bytes('2a');
    const data = `0x${selector}${spenderWord}${deltaWord}`;

    const report = generateJsonReport(data)!;
    expect(report.type).toBe('erc20_increaseAllowance');
    expect(report.payload.spender).toBe(`0x${spender}`);
  });

  it('reports decreaseAllowance', () => {
    const selector = 'a457c2d7'; // decreaseAllowance
    const spender = '3333333333333333333333333333333333333333';
    const spenderWord = pad32Bytes(`000000000000000000000000${spender}`);
    const deltaWord = pad32Bytes('07');
    const data = `0x${selector}${spenderWord}${deltaWord}`;

    const report = generateJsonReport(data)!;
    expect(report.type).toBe('erc20_decreaseAllowance');
    expect(report.payload.spender).toBe(`0x${spender}`);
  });

  it('reports NFT setApprovalForAll grants as approve-all for both standards', () => {
    const selector = 'a22cb465'; // setApprovalForAll
    const operator = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const operatorWord = pad32Bytes(`000000000000000000000000${operator}`);
    const approvedWord = pad32Bytes('1');
    const data = `0x${selector}${operatorWord}${approvedWord}`;

    const report = generateJsonReport(data)!;
    expect(report.type).toBe('nft_setApprovalForAll');
    expect(report.payload.operator).toBe(`0x${operator}`);
    expect(report.payload.approved).toBe(true);
    expect(report.payload.isApproveAll).toBe(true);
    expect(report.payload.standards).toEqual(['erc721', 'erc1155']);
    expect(report.risks).toEqual(['erc721_approve_all', 'erc1155_approve_all']);
  });

  it('reports NFT setApprovalForAll revocations without approve-all risk', () => {
    const selector = 'a22cb465';
    const operator = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const operatorWord = pad32Bytes(`000000000000000000000000${operator}`);
    const approvedWord = pad32Bytes('0');
    const data = `0x${selector}${operatorWord}${approvedWord}`;

    const report = generateJsonReport(data)!;
    expect(report.type).toBe('nft_setApprovalForAll');
    expect(report.payload.approved).toBe(false);
    expect(report.payload.isApproveAll).toBe(false);
    expect(report.risks).toEqual([]);
  });
});

