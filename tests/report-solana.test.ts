import { describe, it, expect } from 'vitest';
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from '@solana/web3.js';
import {
  formatReportFooter,
  generateJsonReportFromAny,
} from '../src/report';
import { renderHtmlReport } from '../src/html';

const BLOCKHASH = PublicKey.default.toBase58();

function signedTransferBase64(lamports: number): {
  payer: Keypair;
  dest: Keypair;
  encoded: string;
} {
  const payer = Keypair.generate();
  const dest = Keypair.generate();
  const tx = new Transaction({
    feePayer: payer.publicKey,
    recentBlockhash: BLOCKHASH,
  }).add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: dest.publicKey,
      lamports,
    })
  );
  tx.sign(payer);
  return {
    payer,
    dest,
    encoded: Buffer.from(tx.serialize()).toString('base64'),
  };
}

describe('Solana reports', () => {
  it('reports a serialized transfer as solana_tx with no risks', () => {
    const { payer, dest, encoded } = signedTransferBase64(99);
    const report = generateJsonReportFromAny(encoded);
    expect(report).not.toBeNull();
    expect(report!.type).toBe('solana_tx');
    if (report?.type !== 'solana_tx') return;
    expect(report.payload.version).toBe('legacy');
    expect(report.payload.feePayer).toBe(payer.publicKey.toBase58());
    expect(report.payload.accountKeys).toContain(dest.publicKey.toBase58());
    expect(report.payload.instructions).toHaveLength(1);
    expect(report.payload.instructions[0]!.programId).toBe(
      SystemProgram.programId.toBase58()
    );
    expect(report.risks).toEqual([]);
    expect(report.severity).toBe('info');
    expect(() => JSON.stringify(report)).not.toThrow();
  });

  it('prints version, fee payer, and instruction count in the footer', () => {
    const { payer, encoded } = signedTransferBase64(1);
    const report = generateJsonReportFromAny(encoded)!;
    const footer = formatReportFooter(report);
    expect(footer).toContain('Version: legacy');
    expect(footer).toContain(`Fee payer: ${payer.publicKey.toBase58()}`);
    expect(footer).toContain('Instructions: 1');
  });

  it('renders a script-free HTML page for a Solana skeleton', () => {
    const { encoded } = signedTransferBase64(7);
    const report = generateJsonReportFromAny(encoded)!;
    const html = renderHtmlReport(report, 'Solana sample');
    expect(html).toContain('<code>solana_tx</code>');
    expect(html).toContain(SystemProgram.programId.toBase58());
    expect(html).toContain('instruction 0');
    expect(html).not.toContain('<script');
  });

  it('still prefers EVM decoding for ERC-20 calldata', () => {
    const data =
      '0x095ea7b3' +
      '0'.repeat(24) +
      'aa'.repeat(20) +
      'f'.repeat(64);
    const report = generateJsonReportFromAny(data);
    expect(report?.type).toBe('erc20_approve');
  });
});
