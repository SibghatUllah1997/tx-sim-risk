import { PublicKey, TransactionInstruction } from '@solana/web3.js';
import {
  AuthorityType,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  decodeInstruction,
  isSetAuthorityInstruction,
  isTransferCheckedInstruction,
  isTransferInstruction,
} from '@solana/spl-token';
import { stripHexPrefix } from '../evm/hex';
import { SPL_TOKEN_2022_PROGRAM_ID, SPL_TOKEN_PROGRAM_ID } from './ata';
import type { SolanaInstructionSkeleton, SolanaTxSkeleton } from './skeleton';

/** Risk id when a token account or mint authority is reassigned or cleared. */
export const SOLANA_AUTHORITY_CHANGE_RISK = 'solana_authority_change';

export type SplTokenKind = 'transfer' | 'transfer_checked' | 'set_authority';

export type SplAuthorityTypeName =
  | 'mint_tokens'
  | 'freeze_account'
  | 'account_owner'
  | 'close_account'
  | 'other';

/**
 * One decoded SPL Token / Token-2022 instruction. Fields that do not apply
 * to the kind are null (a Transfer has no mint; a SetAuthority has no amount).
 */
export type SolanaSplInstruction = {
  instructionIndex: number;
  kind: SplTokenKind;
  programId: string;
  isToken2022: boolean;
  source: string | null;
  destination: string | null;
  mint: string | null;
  owner: string | null;
  amount: string | null;
  decimals: number | null;
  account: string | null;
  currentAuthority: string | null;
  newAuthority: string | null;
  authorityType: SplAuthorityTypeName | null;
  isAuthorityRevoked: boolean;
};

function authorityTypeName(type: AuthorityType): SplAuthorityTypeName {
  switch (type) {
    case AuthorityType.MintTokens:
      return 'mint_tokens';
    case AuthorityType.FreezeAccount:
      return 'freeze_account';
    case AuthorityType.AccountOwner:
      return 'account_owner';
    case AuthorityType.CloseAccount:
      return 'close_account';
    default:
      return 'other';
  }
}

function isTokenProgram(programId: string): boolean {
  return (
    programId === SPL_TOKEN_PROGRAM_ID || programId === SPL_TOKEN_2022_PROGRAM_ID
  );
}

function toTxInstruction(
  ix: SolanaInstructionSkeleton
): TransactionInstruction | null {
  try {
    const dataHex = stripHexPrefix(ix.dataHex);
    return new TransactionInstruction({
      programId: new PublicKey(ix.programId),
      keys: ix.accounts.map((account) => ({
        pubkey: new PublicKey(account),
        isSigner: false,
        isWritable: false,
      })),
      data: Buffer.from(dataHex, 'hex'),
    });
  } catch {
    return null;
  }
}

function emptyFields(): Omit<
  SolanaSplInstruction,
  'instructionIndex' | 'kind' | 'programId' | 'isToken2022'
> {
  return {
    source: null,
    destination: null,
    mint: null,
    owner: null,
    amount: null,
    decimals: null,
    account: null,
    currentAuthority: null,
    newAuthority: null,
    authorityType: null,
    isAuthorityRevoked: false,
  };
}

/**
 * Decode SPL Token Transfer, TransferChecked, and SetAuthority instructions
 * from a Solana tx skeleton. Other token-program calls are ignored.
 */
export function detectSplTokenInstructions(
  skeleton: SolanaTxSkeleton
): SolanaSplInstruction[] {
  const found: SolanaSplInstruction[] = [];
  skeleton.instructions.forEach((ix, instructionIndex) => {
    if (!isTokenProgram(ix.programId)) return;
    const txIx = toTxInstruction(ix);
    if (!txIx) return;
    const programId =
      ix.programId === SPL_TOKEN_2022_PROGRAM_ID
        ? TOKEN_2022_PROGRAM_ID
        : TOKEN_PROGRAM_ID;
    let decoded;
    try {
      decoded = decodeInstruction(txIx, programId);
    } catch {
      return;
    }
    const isToken2022 = ix.programId === SPL_TOKEN_2022_PROGRAM_ID;
    if (isTransferInstruction(decoded)) {
      found.push({
        instructionIndex,
        kind: 'transfer',
        programId: ix.programId,
        isToken2022,
        ...emptyFields(),
        source: decoded.keys.source.pubkey.toBase58(),
        destination: decoded.keys.destination.pubkey.toBase58(),
        owner: decoded.keys.owner.pubkey.toBase58(),
        amount: decoded.data.amount.toString(),
      });
      return;
    }
    if (isTransferCheckedInstruction(decoded)) {
      found.push({
        instructionIndex,
        kind: 'transfer_checked',
        programId: ix.programId,
        isToken2022,
        ...emptyFields(),
        source: decoded.keys.source.pubkey.toBase58(),
        destination: decoded.keys.destination.pubkey.toBase58(),
        mint: decoded.keys.mint.pubkey.toBase58(),
        owner: decoded.keys.owner.pubkey.toBase58(),
        amount: decoded.data.amount.toString(),
        decimals: decoded.data.decimals,
      });
      return;
    }
    if (isSetAuthorityInstruction(decoded)) {
      const newAuthority = decoded.data.newAuthority
        ? decoded.data.newAuthority.toBase58()
        : null;
      found.push({
        instructionIndex,
        kind: 'set_authority',
        programId: ix.programId,
        isToken2022,
        ...emptyFields(),
        account: decoded.keys.account.pubkey.toBase58(),
        currentAuthority: decoded.keys.currentAuthority.pubkey.toBase58(),
        newAuthority,
        authorityType: authorityTypeName(decoded.data.authorityType),
        isAuthorityRevoked: newAuthority == null,
      });
    }
  });
  return found;
}

/** Risk ids for decoded SPL instructions. Empty unless an authority changes. */
export function splTokenRisks(
  found: readonly SolanaSplInstruction[]
): string[] {
  return found.some((ix) => ix.kind === 'set_authority')
    ? [SOLANA_AUTHORITY_CHANGE_RISK]
    : [];
}
