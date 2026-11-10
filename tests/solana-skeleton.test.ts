import { describe, it, expect } from 'vitest';
import {
  Keypair,
  MessageV0,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import {
  bytesFromSolanaInput,
  parseSolanaTxSkeleton,
} from '../src/solana/skeleton';

const BLOCKHASH = PublicKey.default.toBase58();
const SYSTEM_PROGRAM = SystemProgram.programId.toBase58();

function signedLegacyTransfer(lamports: number): {
  payer: Keypair;
  dest: Keypair;
  bytes: Uint8Array;
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
  return { payer, dest, bytes: tx.serialize() };
}

function signedV0Transfer(lamports: number): {
  payer: Keypair;
  dest: Keypair;
  bytes: Uint8Array;
} {
  const payer = Keypair.generate();
  const dest = Keypair.generate();
  const message = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: BLOCKHASH,
    instructions: [
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: dest.publicKey,
        lamports,
      }),
    ],
  }).compileToV0Message();
  const vtx = new VersionedTransaction(message);
  vtx.sign([payer]);
  return { payer, dest, bytes: vtx.serialize() };
}

describe('bytesFromSolanaInput', () => {
  it('accepts 0x-hex, raw hex, and matching base64', () => {
    const { bytes } = signedLegacyTransfer(10);
    const hex = Buffer.from(bytes).toString('hex');
    const b64 = Buffer.from(bytes).toString('base64');
    expect(Buffer.from(bytesFromSolanaInput(`0x${hex}`)!)).toEqual(
      Buffer.from(bytes)
    );
    expect(Buffer.from(bytesFromSolanaInput(hex)!)).toEqual(Buffer.from(bytes));
    expect(Buffer.from(bytesFromSolanaInput(b64)!)).toEqual(Buffer.from(bytes));
  });

  it('rejects empty, odd-length hex, and malformed base64', () => {
    expect(bytesFromSolanaInput('')).toBeNull();
    expect(bytesFromSolanaInput('0x')).toBeNull();
    expect(bytesFromSolanaInput('0xabc')).toBeNull();
    expect(bytesFromSolanaInput('@@@')).toBeNull();
    expect(bytesFromSolanaInput('ab$c')).toBeNull();
  });
});

describe('parseSolanaTxSkeleton', () => {
  it('parses a signed legacy system transfer', () => {
    const { payer, dest, bytes } = signedLegacyTransfer(1234);
    const skeleton = parseSolanaTxSkeleton(Buffer.from(bytes).toString('base64'));
    expect(skeleton).not.toBeNull();
    expect(skeleton!.version).toBe('legacy');
    expect(skeleton!.feePayer).toBe(payer.publicKey.toBase58());
    expect(skeleton!.recentBlockhash).toBe(BLOCKHASH);
    expect(skeleton!.header.numRequiredSignatures).toBe(1);
    expect(skeleton!.accountKeys).toContain(dest.publicKey.toBase58());
    expect(skeleton!.instructions).toHaveLength(1);
    expect(skeleton!.instructions[0]!.programId).toBe(SYSTEM_PROGRAM);
    expect(skeleton!.instructions[0]!.accounts).toEqual([
      payer.publicKey.toBase58(),
      dest.publicKey.toBase58(),
    ]);
    expect(skeleton!.addressTableLookups).toEqual([]);
    expect(skeleton!.signatures).toHaveLength(1);
    expect(skeleton!.signatures[0]).toMatch(/^0x[0-9a-f]{128}$/);
  });

  it('parses a signed v0 system transfer from hex', () => {
    const { payer, dest, bytes } = signedV0Transfer(50);
    const skeleton = parseSolanaTxSkeleton(
      `0x${Buffer.from(bytes).toString('hex')}`
    );
    expect(skeleton).not.toBeNull();
    expect(skeleton!.version).toBe(0);
    expect(skeleton!.feePayer).toBe(payer.publicKey.toBase58());
    expect(skeleton!.instructions[0]!.programId).toBe(SYSTEM_PROGRAM);
    expect(skeleton!.instructions[0]!.accounts).toContain(
      dest.publicKey.toBase58()
    );
  });

  it('surfaces address-table lookups on a v0 message', () => {
    const payer = Keypair.generate();
    const lookup = Keypair.generate();
    const message = new MessageV0({
      header: {
        numRequiredSignatures: 1,
        numReadonlySignedAccounts: 0,
        numReadonlyUnsignedAccounts: 1,
      },
      staticAccountKeys: [payer.publicKey, SystemProgram.programId],
      recentBlockhash: BLOCKHASH,
      compiledInstructions: [
        {
          programIdIndex: 1,
          accountKeyIndexes: [0],
          data: new Uint8Array([2, 0, 0, 0]),
        },
      ],
      addressTableLookups: [
        {
          accountKey: lookup.publicKey,
          writableIndexes: [3],
          readonlyIndexes: [4, 5],
        },
      ],
    });
    const vtx = new VersionedTransaction(message);
    vtx.sign([payer]);
    const skeleton = parseSolanaTxSkeleton(
      Buffer.from(vtx.serialize()).toString('base64')
    );
    expect(skeleton!.version).toBe(0);
    expect(skeleton!.addressTableLookups).toEqual([
      {
        accountKey: lookup.publicKey.toBase58(),
        writableIndexes: [3],
        readonlyIndexes: [4, 5],
      },
    ]);
  });

  it('returns null for EVM calldata and other non-transactions', () => {
    const approve =
      '0x095ea7b3' +
      '0'.repeat(24) +
      'aa'.repeat(20) +
      'f'.repeat(64);
    expect(parseSolanaTxSkeleton(approve)).toBeNull();
    expect(parseSolanaTxSkeleton('0xdeadbeef')).toBeNull();
    expect(parseSolanaTxSkeleton('not-a-transaction')).toBeNull();
  });
});
