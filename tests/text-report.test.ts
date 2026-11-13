import { describe, it, expect } from 'vitest';
import { encodeFunctionData, parseAbi, serializeTransaction, type Hex } from 'viem';
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from '@solana/web3.js';
import {
  createDecoderRegistry,
  defineChainDecoder,
  formatChainIdLine,
  formatDetectedHeader,
  formatFeeAnalysis,
  formatPlainTextAnalysis,
  formatPlainTextReport,
  generateJsonReport,
  generateJsonReportFromAny,
  pluginDecodeReport,
  type JsonReport,
} from '../src';

function word(hexNoPrefix: string): string {
  return hexNoPrefix.padStart(64, '0');
}

function addressWord(addressNo0x: string): string {
  return word(addressNo0x.toLowerCase());
}

function approve(spenderNo0x: string, amountHex: string): string {
  return `0x095ea7b3${addressWord(spenderNo0x)}${word(amountHex)}`;
}

function transfer(toNo0x: string, amountHex: string): string {
  return `0xa9059cbb${addressWord(toNo0x)}${word(amountHex)}`;
}

function increaseAllowance(spenderNo0x: string, amountHex: string): string {
  return `0x39509351${addressWord(spenderNo0x)}${word(amountHex)}`;
}

function decreaseAllowance(spenderNo0x: string, amountHex: string): string {
  return `0xa457c2d7${addressWord(spenderNo0x)}${word(amountHex)}`;
}

function setApprovalForAll(operatorNo0x: string, approved: boolean): string {
  return `0xa22cb465${addressWord(operatorNo0x)}${word(approved ? '1' : '0')}`;
}

const ROUTER = '7a250d5630b4cf539739df2c5dacb4c659f2488d';
const RECIPIENT = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function eip1559RawTx(data: Hex, chainId = 137): Hex {
  return serializeTransaction({
    type: 'eip1559',
    chainId,
    nonce: 7,
    gas: 60_000n,
    maxPriorityFeePerGas: 2_000_000_000n,
    maxFeePerGas: 30_000_000_000n,
    to: `0x${'cc'.repeat(20)}`,
    value: 0n,
    data,
  });
}

describe('formatDetectedHeader', () => {
  it('prints approve, transfer, and allowance grants the way the CLI does', () => {
    expect(
      formatDetectedHeader(generateJsonReport(approve(ROUTER, '0a'))!)
    ).toEqual([
      'Detected: ERC-20 approve(address,uint256)',
      `Spender: 0x${ROUTER}`,
      'Amount: 10',
      'Unlimited approval: no',
    ]);
    expect(
      formatDetectedHeader(generateJsonReport(transfer(RECIPIENT, '64'))!)
    ).toEqual([
      'Detected: ERC-20 transfer(address,uint256)',
      `To: 0x${RECIPIENT}`,
      'Amount: 100',
      'Burn address: no',
    ]);
    expect(
      formatDetectedHeader(generateJsonReport(increaseAllowance(ROUTER, '2a'))!)
    ).toEqual([
      'Detected: ERC-20 increaseAllowance(address,uint256)',
      `Spender: 0x${ROUTER}`,
      'Delta: +42',
    ]);
    expect(
      formatDetectedHeader(generateJsonReport(decreaseAllowance(ROUTER, '07'))!)
    ).toEqual([
      'Detected: ERC-20 decreaseAllowance(address,uint256)',
      `Spender: 0x${ROUTER}`,
      'Delta: -7',
    ]);
  });

  it('prints NFT operator grants for both standards', () => {
    expect(
      formatDetectedHeader(generateJsonReport(setApprovalForAll(ROUTER, true))!)
    ).toEqual([
      'Detected: setApprovalForAll(address,bool) [ERC-721 / ERC-1155]',
      `Operator: 0x${ROUTER}`,
      'Approved: yes',
      'ERC-721 approve-all: yes',
      'ERC-1155 approve-all: yes',
    ]);
  });

  it('prints ABI-decoded calls including nested array values', () => {
    const data = encodeFunctionData({
      abi: parseAbi([
        'function safeBatchTransferFrom(address from, address to, uint256[] ids, uint256[] values, bytes data)',
      ]),
      functionName: 'safeBatchTransferFrom',
      args: [
        `0x${'11'.repeat(20)}`,
        `0x${RECIPIENT}`,
        [1n, 2n],
        [10n, 20n],
        '0xabcd',
      ],
    });
    const header = formatDetectedHeader(generateJsonReport(data)!);
    expect(header[0]).toBe(
      'Detected: safeBatchTransferFrom(address,address,uint256[],uint256[],bytes) [via ABI]'
    );
    expect(header).toContain('ids (uint256[]): [1, 2]');
    expect(header).toContain('values (uint256[]): [10, 20]');
  });

  it('prints a Solana skeleton with one instruction per line', () => {
    const payer = Keypair.generate();
    const tx = new Transaction({
      feePayer: payer.publicKey,
      recentBlockhash: PublicKey.default.toBase58(),
    }).add(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: Keypair.generate().publicKey,
        lamports: 5_000,
      })
    );
    tx.sign(payer);
    const input = Buffer.from(tx.serialize()).toString('base64');
    const report = generateJsonReportFromAny(input)!;
    const header = formatDetectedHeader(report);
    expect(header[0]).toBe('Detected: Solana transaction (legacy)');
    expect(header[1]).toBe(`Fee payer: ${payer.publicKey.toBase58()}`);
    expect(header.some((line) => line.startsWith('  [0] program='))).toBe(true);
  });

  it('prints plugin identity before the shared footer', () => {
    const demo = defineChainDecoder<JsonReport>({
      id: 'demo',
      name: 'Demo chain',
      tryDecode(input) {
        if (!input.startsWith('demo:')) return null;
        return pluginDecodeReport(
          { id: 'demo', name: 'Demo chain' },
          { summary: 'ping', fields: { raw: input } }
        );
      },
    });
    const report = generateJsonReportFromAny('demo:ping', {
      decoders: createDecoderRegistry([demo]),
    })!;
    expect(formatDetectedHeader(report)).toEqual([
      'Detected: Demo chain via plugin demo',
      'Summary: ping',
    ]);
  });
});

describe('formatPlainTextAnalysis', () => {
  it('joins header and footer, including risks, for an unlimited approve', () => {
    const lines = formatPlainTextAnalysis(approve(ROUTER, 'f'.repeat(64)))!;
    expect(lines[0]).toBe('Detected: ERC-20 approve(address,uint256)');
    expect(lines).toContain('Unlimited approval: yes');
    expect(lines).toContain('Severity: high');
    expect(lines.some((line) => line.startsWith('Risks: unlimited_approval'))).toBe(
      true
    );
    expect(formatPlainTextReport(generateJsonReport(approve(ROUTER, '01'))!).length).toBeGreaterThan(
      3
    );
  });

  it('returns null for unrecognized calldata', () => {
    expect(formatPlainTextAnalysis('0xdeadbeef')).toBeNull();
  });

  it('unwraps an EIP-1559 raw tx the same way JSON reports do', () => {
    const raw = eip1559RawTx(approve(ROUTER, '0a') as Hex);
    const lines = formatPlainTextAnalysis(raw)!;
    expect(lines[0]).toBe('Detected: ERC-20 approve(address,uint256)');
    expect(lines).toContain(`Spender: 0x${ROUTER}`);
  });
});

describe('formatFeeAnalysis and formatChainIdLine', () => {
  it('prints gas fields and chain id for an unsigned type-2 tx', () => {
    const raw = eip1559RawTx(approve(ROUTER, '0a') as Hex, 137);
    expect(formatFeeAnalysis(raw, true)).toEqual([
      'Detected: EIP-1559 raw transaction',
      'Gas limit: 60000',
      'Max priority fee per gas: 2000000000 wei',
      'Max fee per gas: 30000000000 wei',
      'Chain ID: 137',
    ]);
    expect(formatChainIdLine(raw)).toBe('Chain ID: 137');
  });

  it('says so when --fees is given a non-1559 payload', () => {
    expect(formatFeeAnalysis(approve(ROUTER, '0a'), false)).toEqual([
      'No EIP-1559 fee fields found in input.',
    ]);
    expect(formatChainIdLine(approve(ROUTER, '0a'))).toBe('Chain ID: unknown');
  });
});
