import { describe, it, expect } from 'vitest';
import {
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID as SPL_ATA_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createAssociatedTokenAccountInstruction,
  createRecoverNestedInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  SOLANA_ATA_MISMATCH_RISK,
  SPL_TOKEN_2022_PROGRAM_ID,
  SPL_TOKEN_PROGRAM_ID,
  associatedTokenAccountRisks,
  deriveAssociatedTokenAddress,
  detectAssociatedTokenAccounts,
} from '../src/solana/ata';
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

describe('ATA program constants', () => {
  it('match the SPL library ids', () => {
    expect(ASSOCIATED_TOKEN_PROGRAM_ID).toBe(SPL_ATA_ID.toBase58());
    expect(SPL_TOKEN_PROGRAM_ID).toBe(TOKEN_PROGRAM_ID.toBase58());
    expect(SPL_TOKEN_2022_PROGRAM_ID).toBe(TOKEN_2022_PROGRAM_ID.toBase58());
  });
});

describe('deriveAssociatedTokenAddress', () => {
  it('agrees with the SPL library for both token programs', () => {
    const wallet = Keypair.generate().publicKey;
    const mint = Keypair.generate().publicKey;
    for (const program of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
      expect(
        deriveAssociatedTokenAddress(
          wallet.toBase58(),
          mint.toBase58(),
          program.toBase58()
        )
      ).toBe(getAssociatedTokenAddressSync(mint, wallet, false, program).toBase58());
    }
  });

  it('returns null for malformed keys', () => {
    expect(deriveAssociatedTokenAddress('nope', 'nope')).toBeNull();
  });
});

describe('detectAssociatedTokenAccounts', () => {
  it('detects create and createIdempotent with matching derivation', () => {
    const payer = Keypair.generate();
    const wallet = Keypair.generate().publicKey;
    const mint = Keypair.generate().publicKey;
    const ata = getAssociatedTokenAddressSync(mint, wallet);
    const skeleton = skeletonFor(
      payer,
      createAssociatedTokenAccountInstruction(payer.publicKey, ata, wallet, mint),
      createAssociatedTokenAccountIdempotentInstruction(
        payer.publicKey,
        ata,
        wallet,
        mint
      )
    );
    const found = detectAssociatedTokenAccounts(skeleton);
    expect(found.map((f) => f.kind)).toEqual(['create', 'createIdempotent']);
    expect(found[0]).toMatchObject({
      instructionIndex: 0,
      payer: payer.publicKey.toBase58(),
      associatedAccount: ata.toBase58(),
      wallet: wallet.toBase58(),
      mint: mint.toBase58(),
      tokenProgram: SPL_TOKEN_PROGRAM_ID,
      isKnownTokenProgram: true,
      expectedAddress: ata.toBase58(),
      matchesDerivation: true,
    });
    expect(associatedTokenAccountRisks(found)).toEqual([]);
  });

  it('flags an ATA account that is not the derived address', () => {
    const payer = Keypair.generate();
    const wallet = Keypair.generate().publicKey;
    const mint = Keypair.generate().publicKey;
    const wrong = Keypair.generate().publicKey;
    const skeleton = skeletonFor(
      payer,
      createAssociatedTokenAccountIdempotentInstruction(
        payer.publicKey,
        wrong,
        wallet,
        mint
      )
    );
    const found = detectAssociatedTokenAccounts(skeleton);
    expect(found).toHaveLength(1);
    expect(found[0]!.matchesDerivation).toBe(false);
    expect(found[0]!.expectedAddress).toBe(
      getAssociatedTokenAddressSync(mint, wallet).toBase58()
    );
    expect(associatedTokenAccountRisks(found)).toEqual([SOLANA_ATA_MISMATCH_RISK]);
  });

  it('checks the destination ATA on recoverNested under Token-2022', () => {
    const payer = Keypair.generate();
    const ownerMint = Keypair.generate().publicKey;
    const nestedMint = Keypair.generate().publicKey;
    const skeleton = skeletonFor(
      payer,
      createRecoverNestedInstruction(
        getAssociatedTokenAddressSync(
          nestedMint,
          getAssociatedTokenAddressSync(ownerMint, payer.publicKey, false, TOKEN_2022_PROGRAM_ID),
          true,
          TOKEN_2022_PROGRAM_ID
        ),
        nestedMint,
        getAssociatedTokenAddressSync(nestedMint, payer.publicKey, false, TOKEN_2022_PROGRAM_ID),
        getAssociatedTokenAddressSync(ownerMint, payer.publicKey, false, TOKEN_2022_PROGRAM_ID),
        ownerMint,
        payer.publicKey,
        TOKEN_2022_PROGRAM_ID
      )
    );
    const [found] = detectAssociatedTokenAccounts(skeleton);
    expect(found!.kind).toBe('recoverNested');
    expect(found!.wallet).toBe(payer.publicKey.toBase58());
    expect(found!.mint).toBe(nestedMint.toBase58());
    expect(found!.tokenProgram).toBe(SPL_TOKEN_2022_PROGRAM_ID);
    expect(found!.matchesDerivation).toBe(true);
  });

  it('ignores other programs and marks unknown ATA opcodes', () => {
    const payer = Keypair.generate();
    const other = new TransactionInstruction({
      programId: Keypair.generate().publicKey,
      keys: [],
      data: Buffer.from([1]),
    });
    const odd = new TransactionInstruction({
      programId: new PublicKey(ASSOCIATED_TOKEN_PROGRAM_ID),
      keys: [],
      data: Buffer.from([9]),
    });
    const found = detectAssociatedTokenAccounts(skeletonFor(payer, other, odd));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      instructionIndex: 1,
      kind: 'unknown',
      expectedAddress: null,
      matchesDerivation: null,
    });
    expect(associatedTokenAccountRisks(found)).toEqual([]);
  });
});
