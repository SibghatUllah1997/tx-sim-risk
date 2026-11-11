import { ComputeBudgetProgram, PublicKey, SystemProgram } from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID as SPL_ATA_PROGRAM,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';

export type SuspiciousProgramCategory =
  | 'drainer'
  | 'fake_token'
  | 'approval_scam';

export type SuspiciousProgramEntry = {
  /** Canonical base58 program id. */
  programId: string;
  /** Short stable id for logs and tests. */
  label: string;
  category: SuspiciousProgramCategory;
};

export type WellKnownProgramEntry = {
  programId: string;
  label: string;
};

/**
 * Pack a short ASCII tag into a 32-byte public key. Used only to mint
 * stable fixture program ids that this tool ships for offline matching.
 */
function programIdFromAsciiSeed(seed: string): string {
  const written = Buffer.from(seed, 'utf8');
  if (written.length === 0 || written.length > 32) {
    throw new Error(`ASCII seed must be 1–32 bytes: ${seed}`);
  }
  const bytes = Buffer.alloc(32);
  written.copy(bytes);
  return new PublicKey(bytes).toBase58();
}

/** Built-in fixture: a seed drainer program id. */
export const SEED_DRAINER_PROGRAM_ID = programIdFromAsciiSeed('txsim:drainer');

/** Built-in fixture: a seed fake-token program id. */
export const SEED_FAKE_TOKEN_PROGRAM_ID =
  programIdFromAsciiSeed('txsim:faketoken');

/** Built-in fixture: a seed approval-scam program id. */
export const SEED_APPROVAL_SCAM_PROGRAM_ID =
  programIdFromAsciiSeed('txsim:approvals');

/**
 * Normalize a Solana program id to canonical base58. Returns null when
 * the string is empty or not a well-formed 32-byte public key.
 */
export function normalizeProgramId(programId: string): string | null {
  const trimmed = programId.trim();
  if (!trimmed) return null;
  try {
    return new PublicKey(trimmed).toBase58();
  } catch {
    return null;
  }
}

function freezeEntry(entry: SuspiciousProgramEntry): SuspiciousProgramEntry {
  const key = normalizeProgramId(entry.programId);
  if (!key) {
    throw new Error(`Invalid suspicious program id: ${entry.programId}`);
  }
  return Object.freeze({
    programId: key,
    label: entry.label,
    category: entry.category,
  });
}

const SEED_ENTRIES: readonly SuspiciousProgramEntry[] = [
  {
    programId: SEED_DRAINER_PROGRAM_ID,
    label: 'seed_drainer_program',
    category: 'drainer',
  },
  {
    programId: SEED_FAKE_TOKEN_PROGRAM_ID,
    label: 'seed_fake_token_program',
    category: 'fake_token',
  },
  {
    programId: SEED_APPROVAL_SCAM_PROGRAM_ID,
    label: 'seed_approval_scam_program',
    category: 'approval_scam',
  },
];

/**
 * Built-in seed of known-bad Solana program ids for offline matching.
 *
 * These keys are fixtures this tool ships with so CPI rules can be tested
 * without a network. Callers should merge current threat-intel on top via
 * {@link mergeSuspiciousPrograms}.
 */
export const DEFAULT_SUSPICIOUS_PROGRAMS: readonly SuspiciousProgramEntry[] =
  Object.freeze(SEED_ENTRIES.map(freezeEntry));

/**
 * Frequently seen first-party program ids. They are never treated as
 * suspicious by default; the list is here so scanners can skip noise
 * when they walk remaining accounts looking for CPI targets.
 */
export const WELL_KNOWN_SOLANA_PROGRAMS: readonly WellKnownProgramEntry[] =
  Object.freeze([
    Object.freeze({
      programId: SystemProgram.programId.toBase58(),
      label: 'system',
    }),
    Object.freeze({
      programId: TOKEN_PROGRAM_ID.toBase58(),
      label: 'spl_token',
    }),
    Object.freeze({
      programId: TOKEN_2022_PROGRAM_ID.toBase58(),
      label: 'spl_token_2022',
    }),
    Object.freeze({
      programId: SPL_ATA_PROGRAM.toBase58(),
      label: 'associated_token',
    }),
    Object.freeze({
      programId: ComputeBudgetProgram.programId.toBase58(),
      label: 'compute_budget',
    }),
  ]);

const WELL_KNOWN_IDS: ReadonlySet<string> = new Set(
  WELL_KNOWN_SOLANA_PROGRAMS.map((entry) => entry.programId)
);

/** True when `programId` is a well-known first-party Solana program. */
export function isWellKnownSolanaProgram(programId: string): boolean {
  const key = normalizeProgramId(programId);
  return key !== null && WELL_KNOWN_IDS.has(key);
}

/**
 * Build a program-id → entry index. Duplicate ids keep the last entry.
 * Throws if any program id is not a well-formed public key.
 */
export function createSuspiciousProgramIndex(
  entries: readonly SuspiciousProgramEntry[] = DEFAULT_SUSPICIOUS_PROGRAMS
): ReadonlyMap<string, SuspiciousProgramEntry> {
  const map = new Map<string, SuspiciousProgramEntry>();
  for (const entry of entries) {
    const frozen = freezeEntry(entry);
    map.set(frozen.programId, frozen);
  }
  return map;
}

const DEFAULT_INDEX = createSuspiciousProgramIndex();

/**
 * Look up a suspicious-program entry by id. Matching accepts any
 * PublicKey-parseable encoding and returns the canonical base58 form.
 * Returns undefined for unknown or invalid input (does not throw).
 */
export function lookupSuspiciousProgram(
  programId: string,
  index: ReadonlyMap<string, SuspiciousProgramEntry> = DEFAULT_INDEX
): SuspiciousProgramEntry | undefined {
  const key = normalizeProgramId(programId);
  if (!key) return undefined;
  return index.get(key);
}

/**
 * True when `programId` is on the given suspicious index (default: built-in seed).
 */
export function isSuspiciousProgram(
  programId: string,
  index: ReadonlyMap<string, SuspiciousProgramEntry> = DEFAULT_INDEX
): boolean {
  return lookupSuspiciousProgram(programId, index) !== undefined;
}

/**
 * Return a new list with `extra` merged onto `base`. Extra entries with the
 * same program id replace the base entry.
 */
export function mergeSuspiciousPrograms(
  extra: readonly SuspiciousProgramEntry[],
  base: readonly SuspiciousProgramEntry[] = DEFAULT_SUSPICIOUS_PROGRAMS
): readonly SuspiciousProgramEntry[] {
  return Object.freeze([
    ...createSuspiciousProgramIndex([...base, ...extra]).values(),
  ]);
}
