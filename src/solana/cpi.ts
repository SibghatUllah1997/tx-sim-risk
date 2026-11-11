import type { SolanaTxSkeleton } from './skeleton';
import {
  createSuspiciousProgramIndex,
  isWellKnownSolanaProgram,
  lookupSuspiciousProgram,
  type SuspiciousProgramCategory,
  type SuspiciousProgramEntry,
} from './programs';

/** Risk id emitted when a tx invokes or can CPI into a known-bad program. */
export const SOLANA_SUSPICIOUS_CPI_RISK = 'solana_suspicious_cpi';

/**
 * How the suspicious program appears on an instruction.
 *
 * - `invoked`: the compiled instruction's own program id.
 * - `cpi_target`: another account on the instruction, which the callee
 *   can pass to `invoke` / `invoke_signed` as a CPI target.
 */
export type SolanaCpiRole = 'invoked' | 'cpi_target';

export type SolanaCpiHit = {
  instructionIndex: number;
  programId: string;
  role: SolanaCpiRole;
  label: string;
  category: SuspiciousProgramCategory;
};

const DEFAULT_INDEX = createSuspiciousProgramIndex();

function hitFrom(
  instructionIndex: number,
  role: SolanaCpiRole,
  entry: SuspiciousProgramEntry
): SolanaCpiHit {
  return {
    instructionIndex,
    programId: entry.programId,
    role,
    label: entry.label,
    category: entry.category,
  };
}

/**
 * Walk compiled instructions and report every seed-listed program that is
 * either the callee or an extra account the callee can CPI into.
 *
 * Well-known first-party programs (system, token, ATA, compute budget)
 * are skipped even if a caller puts them on a custom index, so remaining
 * accounts that always include those ids do not create false positives.
 */
export function detectSuspiciousCpi(
  skeleton: SolanaTxSkeleton,
  index: ReadonlyMap<string, SuspiciousProgramEntry> = DEFAULT_INDEX
): SolanaCpiHit[] {
  const hits: SolanaCpiHit[] = [];
  skeleton.instructions.forEach((ix, instructionIndex) => {
    const seen = new Set<string>();
    const invoked = lookupSuspiciousProgram(ix.programId, index);
    if (invoked && !isWellKnownSolanaProgram(invoked.programId)) {
      hits.push(hitFrom(instructionIndex, 'invoked', invoked));
      seen.add(invoked.programId);
    }
    for (const account of ix.accounts) {
      const entry = lookupSuspiciousProgram(account, index);
      if (!entry || seen.has(entry.programId)) continue;
      if (isWellKnownSolanaProgram(entry.programId)) continue;
      seen.add(entry.programId);
      hits.push(hitFrom(instructionIndex, 'cpi_target', entry));
    }
  });
  return hits;
}

/** Risk ids for a list of CPI hits. Empty when nothing suspicious was found. */
export function suspiciousCpiRisks(hits: readonly SolanaCpiHit[]): string[] {
  return hits.length > 0 ? [SOLANA_SUSPICIOUS_CPI_RISK] : [];
}
