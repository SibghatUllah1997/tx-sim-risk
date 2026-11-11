import { describe, it, expect } from 'vitest';
import {
  ComputeBudgetProgram,
  PublicKey,
  SystemProgram,
} from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID as SPL_ATA_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import {
  DEFAULT_SUSPICIOUS_PROGRAMS,
  SEED_APPROVAL_SCAM_PROGRAM_ID,
  SEED_DRAINER_PROGRAM_ID,
  SEED_FAKE_TOKEN_PROGRAM_ID,
  WELL_KNOWN_SOLANA_PROGRAMS,
  createSuspiciousProgramIndex,
  isSuspiciousProgram,
  isWellKnownSolanaProgram,
  lookupSuspiciousProgram,
  mergeSuspiciousPrograms,
  normalizeProgramId,
} from '../src/solana/programs';

describe('normalizeProgramId', () => {
  it('canonicalizes a well-formed public key and rejects junk', () => {
    const key = SystemProgram.programId.toBase58();
    expect(normalizeProgramId(` ${key} `)).toBe(key);
    expect(normalizeProgramId('')).toBeNull();
    expect(normalizeProgramId('   ')).toBeNull();
    expect(normalizeProgramId('not-a-program-id')).toBeNull();
  });
});

describe('well-known Solana programs', () => {
  it('matches first-party ids from web3.js and spl-token', () => {
    const byLabel = Object.fromEntries(
      WELL_KNOWN_SOLANA_PROGRAMS.map((e) => [e.label, e.programId])
    );
    expect(byLabel.system).toBe(SystemProgram.programId.toBase58());
    expect(byLabel.spl_token).toBe(TOKEN_PROGRAM_ID.toBase58());
    expect(byLabel.spl_token_2022).toBe(TOKEN_2022_PROGRAM_ID.toBase58());
    expect(byLabel.associated_token).toBe(SPL_ATA_ID.toBase58());
    expect(byLabel.compute_budget).toBe(
      ComputeBudgetProgram.programId.toBase58()
    );
    expect(isWellKnownSolanaProgram(SystemProgram.programId.toBase58())).toBe(
      true
    );
    expect(isWellKnownSolanaProgram(SEED_DRAINER_PROGRAM_ID)).toBe(false);
    expect(isWellKnownSolanaProgram('nope')).toBe(false);
  });
});

describe('suspicious program seed list', () => {
  it('ships an immutable seed of three fixture program ids', () => {
    expect(DEFAULT_SUSPICIOUS_PROGRAMS).toHaveLength(3);
    expect(DEFAULT_SUSPICIOUS_PROGRAMS.map((e) => e.programId).sort()).toEqual(
      [
        SEED_DRAINER_PROGRAM_ID,
        SEED_FAKE_TOKEN_PROGRAM_ID,
        SEED_APPROVAL_SCAM_PROGRAM_ID,
      ].sort()
    );
    expect(new Set(DEFAULT_SUSPICIOUS_PROGRAMS.map((e) => e.programId)).size).toBe(
      3
    );
    expect(() => {
      (DEFAULT_SUSPICIOUS_PROGRAMS as SuspiciousMutable[]).push({
        programId: PublicKey.default.toBase58(),
        label: 'nope',
        category: 'drainer',
      });
    }).toThrow();
  });

  it('looks up seed programs and ignores well-known and invalid ids', () => {
    const entry = lookupSuspiciousProgram(SEED_DRAINER_PROGRAM_ID)!;
    expect(entry.label).toBe('seed_drainer_program');
    expect(entry.category).toBe('drainer');
    expect(isSuspiciousProgram(SEED_FAKE_TOKEN_PROGRAM_ID)).toBe(true);
    expect(isSuspiciousProgram(SystemProgram.programId.toBase58())).toBe(false);
    expect(isSuspiciousProgram('not-a-key')).toBe(false);
    expect(lookupSuspiciousProgram('not-a-key')).toBeUndefined();
  });

  it('throws when building an index that contains a malformed program id', () => {
    expect(() =>
      createSuspiciousProgramIndex([
        {
          programId: 'short',
          label: 'bad',
          category: 'drainer',
        },
      ])
    ).toThrowError(/invalid suspicious program id/i);
  });

  it('merges extra entries and lets extras replace a seed program', () => {
    const extraKey = PublicKey.unique().toBase58();
    const extra = [
      {
        programId: extraKey,
        label: 'extra_drainer',
        category: 'drainer' as const,
      },
      {
        programId: SEED_DRAINER_PROGRAM_ID,
        label: 'replaced_primary',
        category: 'drainer' as const,
      },
    ];
    const merged = mergeSuspiciousPrograms(extra);
    const index = createSuspiciousProgramIndex(merged);

    expect(isSuspiciousProgram(extraKey, index)).toBe(true);
    expect(lookupSuspiciousProgram(SEED_DRAINER_PROGRAM_ID, index)?.label).toBe(
      'replaced_primary'
    );
    expect(isSuspiciousProgram(SEED_FAKE_TOKEN_PROGRAM_ID, index)).toBe(true);
    expect(
      DEFAULT_SUSPICIOUS_PROGRAMS.find(
        (e) => e.programId === SEED_DRAINER_PROGRAM_ID
      )?.label
    ).toBe('seed_drainer_program');
  });
});

type SuspiciousMutable = {
  programId: string;
  label: string;
  category: 'drainer';
};
