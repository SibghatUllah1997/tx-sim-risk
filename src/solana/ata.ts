import { PublicKey } from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID as SPL_ATA_PROGRAM,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import type { SolanaTxSkeleton } from './skeleton';

/** Associated Token Account program id (SPL), taken from @solana/spl-token. */
export const ASSOCIATED_TOKEN_PROGRAM_ID = SPL_ATA_PROGRAM.toBase58();

/** Classic SPL Token program id. */
export const SPL_TOKEN_PROGRAM_ID = TOKEN_PROGRAM_ID.toBase58();

/** SPL Token-2022 program id. */
export const SPL_TOKEN_2022_PROGRAM_ID = TOKEN_2022_PROGRAM_ID.toBase58();

/** Risk id emitted when an ATA instruction names an account that is not the derived address. */
export const SOLANA_ATA_MISMATCH_RISK = 'solana_ata_mismatch';

export type SolanaAtaInstructionKind =
  | 'create'
  | 'createIdempotent'
  | 'recoverNested'
  | 'unknown';

/**
 * One instruction sent to the Associated Token Account program.
 * `expectedAddress` is the PDA derived from wallet, token program and
 * mint; `matchesDerivation` is null when any of those keys could not be
 * resolved (for example, they live in an address lookup table).
 */
export type SolanaAtaInstruction = {
  instructionIndex: number;
  kind: SolanaAtaInstructionKind;
  payer: string | null;
  associatedAccount: string | null;
  wallet: string | null;
  mint: string | null;
  tokenProgram: string | null;
  isKnownTokenProgram: boolean;
  expectedAddress: string | null;
  matchesDerivation: boolean | null;
};

function kindFromData(dataHex: string): SolanaAtaInstructionKind {
  const hex = dataHex.startsWith('0x') ? dataHex.slice(2) : dataHex;
  // An empty body is the original Create encoding.
  if (hex.length === 0) return 'create';
  if (hex.length !== 2) return 'unknown';
  switch (hex) {
    case '00':
      return 'create';
    case '01':
      return 'createIdempotent';
    case '02':
      return 'recoverNested';
    default:
      return 'unknown';
  }
}

function toKey(value: string | null): PublicKey | null {
  if (!value) return null;
  try {
    return new PublicKey(value);
  } catch {
    return null;
  }
}

/**
 * Derive the associated token address for `wallet` + `mint` under
 * `tokenProgram`. Uses web3.js PDA derivation; returns null on bad keys.
 */
export function deriveAssociatedTokenAddress(
  wallet: string,
  mint: string,
  tokenProgram: string = SPL_TOKEN_PROGRAM_ID
): string | null {
  const w = toKey(wallet);
  const m = toKey(mint);
  const t = toKey(tokenProgram);
  if (!w || !m || !t) return null;
  const [address] = PublicKey.findProgramAddressSync(
    [w.toBuffer(), t.toBuffer(), m.toBuffer()],
    SPL_ATA_PROGRAM
  );
  return address.toBase58();
}

function accountAt(accounts: string[], index: number): string | null {
  const value = accounts[index];
  return value ? value : null;
}

/**
 * Account slots per instruction kind, as [ata, wallet, mint, tokenProgram].
 * Create/CreateIdempotent: payer, ata, wallet, mint, system, token.
 * RecoverNested: nested ata, nested mint, dest ata, owner ata, owner mint,
 * wallet, token. The checked derivation there is the destination ATA
 * (wallet + nested mint).
 */
function slotsFor(
  kind: SolanaAtaInstructionKind
): [number, number, number, number] | null {
  if (kind === 'create' || kind === 'createIdempotent') return [1, 2, 3, 5];
  if (kind === 'recoverNested') return [2, 5, 1, 6];
  return null;
}

/**
 * Find every instruction that targets the Associated Token Account program
 * and check that the named account is the one the wallet, mint and token
 * program actually derive to.
 */
export function detectAssociatedTokenAccounts(
  skeleton: SolanaTxSkeleton
): SolanaAtaInstruction[] {
  const found: SolanaAtaInstruction[] = [];
  skeleton.instructions.forEach((ix, instructionIndex) => {
    if (ix.programId !== ASSOCIATED_TOKEN_PROGRAM_ID) return;
    const kind = kindFromData(ix.dataHex);
    const slots = slotsFor(kind);
    const [ataSlot, walletSlot, mintSlot, tokenSlot] = slots ?? [-1, -1, -1, -1];
    const associatedAccount = accountAt(ix.accounts, ataSlot);
    const wallet = accountAt(ix.accounts, walletSlot);
    const mint = accountAt(ix.accounts, mintSlot);
    const tokenProgram = accountAt(ix.accounts, tokenSlot);
    const expectedAddress =
      wallet && mint && tokenProgram
        ? deriveAssociatedTokenAddress(wallet, mint, tokenProgram)
        : null;
    found.push({
      instructionIndex,
      kind,
      payer: kind === 'recoverNested' ? wallet : accountAt(ix.accounts, 0),
      associatedAccount,
      wallet,
      mint,
      tokenProgram,
      isKnownTokenProgram:
        tokenProgram === SPL_TOKEN_PROGRAM_ID ||
        tokenProgram === SPL_TOKEN_2022_PROGRAM_ID,
      expectedAddress,
      matchesDerivation:
        expectedAddress && associatedAccount
          ? expectedAddress === associatedAccount
          : null,
    });
  });
  return found;
}

/** Risk ids for a list of detected ATA instructions. */
export function associatedTokenAccountRisks(
  found: readonly SolanaAtaInstruction[]
): string[] {
  return found.some((ata) => ata.matchesDerivation === false)
    ? [SOLANA_ATA_MISMATCH_RISK]
    : [];
}
