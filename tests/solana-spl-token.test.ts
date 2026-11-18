import { describe, it, expect } from 'vitest';
import {
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createSetAuthorityInstruction,
  createTransferCheckedInstruction,
  createTransferInstruction,
  AuthorityType,
} from '@solana/spl-token';
import { parseSolanaTxSkeleton } from '../src/solana/skeleton';
import {
  SOLANA_AUTHORITY_CHANGE_RISK,
  detectSplTokenInstructions,
  splTokenRisks,
} from '../src/solana/splToken';

const BLOCKHASH = PublicKey.default.toBase58();

function skeletonFor(payer: Keypair, ...ixs: TransactionInstruction[]) {
  const tx = new Transaction({
    feePayer: payer.publicKey,
    recentBlockhash: BLOCKHASH,
  }).add(...ixs);
  tx.sign(payer);
  return parseSolanaTxSkeleton(Buffer.from(tx.serialize()).toString('base64'))!;
}

describe('detectSplTokenInstructions', () => {
  it('decodes Transfer and TransferChecked amounts and accounts', () => {
    const payer = Keypair.generate();
    const source = Keypair.generate().publicKey;
    const dest = Keypair.generate().publicKey;
    const mint = Keypair.generate().publicKey;
    const skeleton = skeletonFor(
      payer,
      createTransferInstruction(source, dest, payer.publicKey, 50n),
      createTransferCheckedInstruction(
        source,
        mint,
        dest,
        payer.publicKey,
        80n,
        6
      )
    );
    const found = detectSplTokenInstructions(skeleton);
    expect(found).toHaveLength(2);
    expect(found[0]).toMatchObject({
      kind: 'transfer',
      source: source.toBase58(),
      destination: dest.toBase58(),
      owner: payer.publicKey.toBase58(),
      amount: '50',
      mint: null,
      isToken2022: false,
    });
    expect(found[1]).toMatchObject({
      kind: 'transfer_checked',
      mint: mint.toBase58(),
      amount: '80',
      decimals: 6,
    });
    expect(splTokenRisks(found)).toEqual([]);
  });

  it('decodes SetAuthority, including a Token-2022 revoke', () => {
    const payer = Keypair.generate();
    const account = Keypair.generate().publicKey;
    const next = Keypair.generate().publicKey;
    const mint = Keypair.generate().publicKey;
    const skeleton = skeletonFor(
      payer,
      createSetAuthorityInstruction(
        account,
        payer.publicKey,
        AuthorityType.AccountOwner,
        next
      ),
      createSetAuthorityInstruction(
        mint,
        payer.publicKey,
        AuthorityType.MintTokens,
        null,
        [],
        TOKEN_2022_PROGRAM_ID
      )
    );
    const found = detectSplTokenInstructions(skeleton);
    expect(found).toHaveLength(2);
    expect(found[0]).toMatchObject({
      kind: 'set_authority',
      account: account.toBase58(),
      currentAuthority: payer.publicKey.toBase58(),
      newAuthority: next.toBase58(),
      authorityType: 'account_owner',
      isAuthorityRevoked: false,
      isToken2022: false,
    });
    expect(found[1]).toMatchObject({
      kind: 'set_authority',
      authorityType: 'mint_tokens',
      newAuthority: null,
      isAuthorityRevoked: true,
      isToken2022: true,
      programId: TOKEN_2022_PROGRAM_ID.toBase58(),
    });
    expect(splTokenRisks(found)).toEqual([SOLANA_AUTHORITY_CHANGE_RISK]);
  });

  it('ignores non-token programs and other token instructions', () => {
    const payer = Keypair.generate();
    const skeleton = skeletonFor(
      payer,
      new TransactionInstruction({
        programId: Keypair.generate().publicKey,
        keys: [{ pubkey: payer.publicKey, isSigner: true, isWritable: true }],
        data: Buffer.from([3, 1, 0, 0, 0, 0, 0, 0, 0]),
      })
    );
    expect(detectSplTokenInstructions(skeleton)).toEqual([]);
    expect(splTokenRisks([])).toEqual([]);
    expect(TOKEN_PROGRAM_ID.toBase58()).toBeTruthy();
  });
});
