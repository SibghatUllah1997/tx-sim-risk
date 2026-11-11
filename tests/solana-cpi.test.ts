import { describe, it, expect } from 'vitest';
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import {
  SEED_DRAINER_PROGRAM_ID,
  SEED_FAKE_TOKEN_PROGRAM_ID,
  createSuspiciousProgramIndex,
  mergeSuspiciousPrograms,
} from '../src/solana/programs';
import {
  SOLANA_SUSPICIOUS_CPI_RISK,
  detectSuspiciousCpi,
  suspiciousCpiRisks,
} from '../src/solana/cpi';
import { parseSolanaTxSkeleton } from '../src/solana/skeleton';

const BLOCKHASH = PublicKey.default.toBase58();

function skeletonFor(payer: Keypair, ...ixs: TransactionInstruction[]) {
  const tx = new Transaction({
    feePayer: payer.publicKey,
    recentBlockhash: BLOCKHASH,
  }).add(...ixs);
  tx.sign(payer);
  return parseSolanaTxSkeleton(Buffer.from(tx.serialize()).toString('base64'))!;
}

describe('detectSuspiciousCpi', () => {
  it('flags a direct invoke of a seed-listed program', () => {
    const payer = Keypair.generate();
    const skeleton = skeletonFor(
      payer,
      new TransactionInstruction({
        programId: new PublicKey(SEED_DRAINER_PROGRAM_ID),
        keys: [{ pubkey: payer.publicKey, isSigner: true, isWritable: true }],
        data: Buffer.alloc(0),
      })
    );
    const hits = detectSuspiciousCpi(skeleton);
    expect(hits).toEqual([
      {
        instructionIndex: 0,
        programId: SEED_DRAINER_PROGRAM_ID,
        role: 'invoked',
        label: 'seed_drainer_program',
        category: 'drainer',
      },
    ]);
    expect(suspiciousCpiRisks(hits)).toEqual([SOLANA_SUSPICIOUS_CPI_RISK]);
  });

  it('flags a listed program sitting in another instruction’s accounts as a CPI target', () => {
    const payer = Keypair.generate();
    const router = Keypair.generate();
    const skeleton = skeletonFor(
      payer,
      new TransactionInstruction({
        programId: router.publicKey,
        keys: [
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
          {
            pubkey: new PublicKey(SEED_FAKE_TOKEN_PROGRAM_ID),
            isSigner: false,
            isWritable: false,
          },
        ],
        data: Buffer.from([1, 2, 3]),
      })
    );
    const hits = detectSuspiciousCpi(skeleton);
    expect(hits).toEqual([
      {
        instructionIndex: 0,
        programId: SEED_FAKE_TOKEN_PROGRAM_ID,
        role: 'cpi_target',
        label: 'seed_fake_token_program',
        category: 'fake_token',
      },
    ]);
    expect(suspiciousCpiRisks(hits)).toEqual([SOLANA_SUSPICIOUS_CPI_RISK]);
  });

  it('does not double-count the callee when it also appears in the account list', () => {
    const payer = Keypair.generate();
    const program = new PublicKey(SEED_DRAINER_PROGRAM_ID);
    const skeleton = skeletonFor(
      payer,
      new TransactionInstruction({
        programId: program,
        keys: [
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
          { pubkey: program, isSigner: false, isWritable: false },
        ],
        data: Buffer.alloc(0),
      })
    );
    const hits = detectSuspiciousCpi(skeleton);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.role).toBe('invoked');
  });

  it('ignores ordinary system transfers and well-known remaining accounts', () => {
    const payer = Keypair.generate();
    const dest = Keypair.generate();
    const skeleton = skeletonFor(
      payer,
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: dest.publicKey,
        lamports: 10,
      }),
      new TransactionInstruction({
        programId: dest.publicKey,
        keys: [
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: Buffer.from([9]),
      })
    );
    expect(detectSuspiciousCpi(skeleton)).toEqual([]);
    expect(suspiciousCpiRisks([])).toEqual([]);
  });

  it('skips well-known programs even when they are placed on a custom index', () => {
    const payer = Keypair.generate();
    const index = createSuspiciousProgramIndex(
      mergeSuspiciousPrograms([
        {
          programId: SystemProgram.programId.toBase58(),
          label: 'spoofed_system',
          category: 'drainer',
        },
      ])
    );
    const skeleton = skeletonFor(
      payer,
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: Keypair.generate().publicKey,
        lamports: 1,
      })
    );
    expect(detectSuspiciousCpi(skeleton, index)).toEqual([]);
  });

  it('honours a caller-supplied index for extra program ids', () => {
    const payer = Keypair.generate();
    const extra = Keypair.generate();
    const index = createSuspiciousProgramIndex(
      mergeSuspiciousPrograms([
        {
          programId: extra.publicKey.toBase58(),
          label: 'extra_drainer',
          category: 'drainer',
        },
      ])
    );
    const skeleton = skeletonFor(
      payer,
      new TransactionInstruction({
        programId: extra.publicKey,
        keys: [{ pubkey: payer.publicKey, isSigner: true, isWritable: true }],
        data: Buffer.alloc(0),
      })
    );
    const hits = detectSuspiciousCpi(skeleton, index);
    expect(hits).toEqual([
      {
        instructionIndex: 0,
        programId: extra.publicKey.toBase58(),
        role: 'invoked',
        label: 'extra_drainer',
        category: 'drainer',
      },
    ]);
  });
});
