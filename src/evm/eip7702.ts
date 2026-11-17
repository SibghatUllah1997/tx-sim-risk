import { isZeroAddress, isHexString, stripHexPrefix } from './hex';
import { bytesToBigInt, rlpDecodeItem, type RlpValue } from './rlp';

/** Cap on authorization-list entries in one type-4 transaction. */
export const MAX_EIP7702_AUTHORIZATIONS = 16;

/** Risk id when a type-4 tx designates a non-zero delegate for the sender. */
export const EIP7702_DELEGATION_RISK = 'eip7702_delegation';

/**
 * Risk id when an authorization uses `chain_id = 0`, so the designation is
 * valid on every chain that implements EIP-7702.
 */
export const EIP7702_BROAD_DELEGATE_RISK = 'eip7702_broad_delegate';

/** One signed authorization from a type-4 transaction. */
export type Eip7702Authorization = {
  chainId: bigint;
  /** Delegation target. The zero address clears a previous designation. */
  address: string;
  nonce: bigint;
  yParity: bigint;
  r: string;
  s: string;
  /** True when `chainId` is 0 (valid on any chain). */
  isAnyChain: boolean;
  /** True when `address` is the zero address (clears code). */
  isRevocation: boolean;
};

/**
 * A decoded EIP-7702 (type-4) transaction. Signatures are not verified:
 * that needs the sender's key and is left to the node.
 */
export type Eip7702Decoded = {
  method: 'eip7702';
  chainId: bigint;
  nonce: bigint;
  to: string | null;
  value: bigint;
  data: string;
  authorizations: Eip7702Authorization[];
};

function asAddress(bytesHex: string): string {
  const padded = bytesHex.replace(/^0x/i, '').padStart(40, '0').slice(-40);
  return `0x${padded.toLowerCase()}`;
}

function asHexWord(bytesHex: string, bytes: number): string {
  const padded = bytesHex.replace(/^0x/i, '').padStart(bytes * 2, '0');
  return `0x${padded.toLowerCase()}`;
}

function rlpString(value: RlpValue, label: string): string {
  if (typeof value !== 'string') {
    throw new Error(`Invalid EIP-7702 transaction: ${label} must be bytes`);
  }
  return value;
}

function parseAuthorization(item: RlpValue, signature: string): Eip7702Authorization {
  if (!Array.isArray(item) || item.length !== 6) {
    throw new Error(`Invalid authorization tuple in ${signature}`);
  }
  const chainId = bytesToBigInt(rlpString(item[0]!, 'authorization chainId'));
  const address = asAddress(rlpString(item[1]!, 'authorization address'));
  const nonce = bytesToBigInt(rlpString(item[2]!, 'authorization nonce'));
  const yParity = bytesToBigInt(rlpString(item[3]!, 'authorization yParity'));
  const r = asHexWord(rlpString(item[4]!, 'authorization r'), 32);
  const s = asHexWord(rlpString(item[5]!, 'authorization s'), 32);
  return {
    chainId,
    address,
    nonce,
    yParity,
    r,
    s,
    isAnyChain: chainId === 0n,
    isRevocation: isZeroAddress(address),
  };
}

/**
 * Parse an EIP-7702 type-4 raw transaction. Returns null when the input is
 * not type `0x04`. Throws on invalid hex or a truncated type-4 payload.
 */
export function parseEip7702(raw: string): Eip7702Decoded | null {
  if (!isHexString(raw)) {
    throw new Error('Invalid hex data');
  }
  const hex = stripHexPrefix(raw).toLowerCase();
  if (hex.length < 2) return null;
  if (!hex.startsWith('04')) return null;

  const payload = hex.slice(2);
  let decoded;
  try {
    decoded = rlpDecodeItem(payload, 0);
  } catch {
    throw new Error('Invalid EIP-7702 transaction encoding');
  }
  const { value, next } = decoded;
  if (next !== payload.length) {
    throw new Error('Invalid EIP-7702 transaction encoding');
  }
  if (!Array.isArray(value)) {
    throw new Error('Invalid EIP-7702 transaction: expected list');
  }
  const fields = value as RlpValue[];
  // Unsigned: 10 fields. Signed: 13 fields (yParity, r, s).
  if (fields.length !== 10 && fields.length !== 13) {
    throw new Error('Invalid EIP-7702 transaction: missing fields');
  }

  const chainId = bytesToBigInt(rlpString(fields[0]!, 'chainId'));
  const nonce = bytesToBigInt(rlpString(fields[1]!, 'nonce'));
  const toBytes = rlpString(fields[5]!, 'to');
  const to = toBytes.length === 0 ? null : asAddress(toBytes);
  const valueWei = bytesToBigInt(rlpString(fields[6]!, 'value'));
  const data = `0x${rlpString(fields[7]!, 'data')}`;
  const authList = fields[9];
  if (!Array.isArray(authList)) {
    throw new Error('Invalid EIP-7702 transaction: authorization_list must be a list');
  }
  if (authList.length > MAX_EIP7702_AUTHORIZATIONS) {
    throw new Error('EIP-7702 authorization list too large');
  }
  if (authList.length === 0) {
    throw new Error('EIP-7702 authorization list is empty');
  }
  const authorizations = authList.map((item) =>
    parseAuthorization(item, 'authorization_list')
  );
  return {
    method: 'eip7702',
    chainId,
    nonce,
    to,
    value: valueWei,
    data,
    authorizations,
  };
}

/** True when any authorization designates a non-zero delegate. */
export function hasEip7702Delegation(decoded: Eip7702Decoded): boolean {
  return decoded.authorizations.some((item) => !item.isRevocation);
}

/** True when any authorization is valid on every chain (`chain_id = 0`). */
export function hasEip7702BroadDelegate(decoded: Eip7702Decoded): boolean {
  return decoded.authorizations.some(
    (item) => item.isAnyChain && !item.isRevocation
  );
}
