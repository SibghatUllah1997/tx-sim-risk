import { VersionedTransaction } from '@solana/web3.js';
import { isHexString, stripHexPrefix } from '../evm/hex';

export type SolanaTxVersion = 'legacy' | 0 | 1;

export type SolanaMessageHeader = {
  numRequiredSignatures: number;
  numReadonlySignedAccounts: number;
  numReadonlyUnsignedAccounts: number;
};

export type SolanaInstructionSkeleton = {
  programId: string;
  programIdIndex: number;
  accounts: string[];
  accountIndexes: number[];
  dataHex: string;
};

export type SolanaAddressTableLookup = {
  accountKey: string;
  writableIndexes: number[];
  readonlyIndexes: number[];
};

/**
 * Chain-agnostic view of a Solana transaction: version, fee payer, keys,
 * compiled instructions, and optional address-table lookups. Instruction
 * bodies are not interpreted; later rules can inspect program ids.
 */
export type SolanaTxSkeleton = {
  version: SolanaTxVersion;
  signatures: string[];
  feePayer: string | null;
  recentBlockhash: string;
  accountKeys: string[];
  header: SolanaMessageHeader;
  instructions: SolanaInstructionSkeleton[];
  addressTableLookups: SolanaAddressTableLookup[];
};

function bytesToHex(bytes: Uint8Array): string {
  return `0x${Buffer.from(bytes).toString('hex')}`;
}

function normalizeBase64(value: string): string {
  return value.replace(/=+$/, '');
}

/**
 * Decode hex (`0x…` or raw) or standard base64 into bytes. Returns null
 * when the string is empty or not a well-formed encoding.
 */
export function bytesFromSolanaInput(input: string): Uint8Array | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('0x') || trimmed.startsWith('0X')) {
    if (!isHexString(trimmed)) return null;
    const hex = stripHexPrefix(trimmed);
    if (hex.length < 2) return null;
    return Uint8Array.from(Buffer.from(hex, 'hex'));
  }

  if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length % 2 === 0) {
    return Uint8Array.from(Buffer.from(trimmed, 'hex'));
  }

  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed)) return null;
  const buf = Buffer.from(trimmed, 'base64');
  if (buf.length === 0) return null;
  if (normalizeBase64(buf.toString('base64')) !== normalizeBase64(trimmed)) {
    return null;
  }
  return new Uint8Array(buf);
}

function skeletonFromVersioned(tx: VersionedTransaction): SolanaTxSkeleton {
  const message = tx.message;
  const accountKeys = message.staticAccountKeys.map((key) => key.toBase58());
  const header = message.header;
  const instructions: SolanaInstructionSkeleton[] =
    message.compiledInstructions.map((ix) => ({
      programId: accountKeys[ix.programIdIndex] ?? '',
      programIdIndex: ix.programIdIndex,
      accountIndexes: [...ix.accountKeyIndexes],
      accounts: ix.accountKeyIndexes.map((index) => accountKeys[index] ?? ''),
      dataHex: bytesToHex(ix.data),
    }));
  const addressTableLookups: SolanaAddressTableLookup[] =
    message.addressTableLookups.map((lookup) => ({
      accountKey: lookup.accountKey.toBase58(),
      writableIndexes: [...lookup.writableIndexes],
      readonlyIndexes: [...lookup.readonlyIndexes],
    }));

  return {
    version: tx.version,
    signatures: tx.signatures.map(bytesToHex),
    feePayer: accountKeys[0] ?? null,
    recentBlockhash: message.recentBlockhash,
    accountKeys,
    header: {
      numRequiredSignatures: header.numRequiredSignatures,
      numReadonlySignedAccounts: header.numReadonlySignedAccounts,
      numReadonlyUnsignedAccounts: header.numReadonlyUnsignedAccounts,
    },
    instructions,
    addressTableLookups,
  };
}

/**
 * Parse a serialized Solana transaction (legacy, v0, or v1) from hex or
 * base64. Returns null when the bytes are not a well-formed transaction.
 */
export function parseSolanaTxSkeleton(
  input: string
): SolanaTxSkeleton | null {
  const bytes = bytesFromSolanaInput(input);
  if (!bytes || bytes.length < 4) return null;
  try {
    return skeletonFromVersioned(VersionedTransaction.deserialize(bytes));
  } catch {
    return null;
  }
}
