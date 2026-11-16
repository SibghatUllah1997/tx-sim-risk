import {
  MAX_UINT256,
  matchSelectorWords,
  normalizeCalldataHex,
  parseAddressFromWord,
  parseUint256FromWord,
} from './hex';

/** Max value of a Permit2 allowance amount (`type(uint160).max`). */
export const MAX_UINT160 = (1n << 160n) - 1n;

/** Max value of a Permit2 allowance expiration (`type(uint48).max`). */
export const MAX_UINT48 = (1n << 48n) - 1n;

/** Which Permit2 function the calldata used. */
export type Permit2Variant =
  | 'approve'
  | 'permit'
  | 'permit_batch'
  | 'permit_transfer_from';

/** One token allowance granted through Permit2 `approve` or `permit`. */
export type Permit2Allowance = {
  token: string;
  amount: bigint;
  expiration: bigint;
  nonce: bigint | null;
};

/**
 * A decoded Uniswap Permit2 call. Allowance methods (`approve`, `permit`,
 * `permit_batch`) and the one-shot `permitTransferFrom` share one shape so
 * the risk rules can treat spenders and expirations the same way.
 */
export type Permit2Decoded = {
  method: 'permit2';
  variant: Permit2Variant;
  /** Token owner. Null for `approve`, which uses `msg.sender`. */
  owner: string | null;
  /** Allowance spender. Null for `permitTransferFrom`. */
  spender: string | null;
  /** Token of the first allowance or of the transfer. */
  token: string;
  /** First allowance amount, or the signed transfer amount. */
  amount: bigint;
  /** Allowance expiration. Null for `permitTransferFrom`. */
  expiration: bigint | null;
  /** Signature deadline. Null for on-chain `approve`. */
  deadline: bigint | null;
  nonce: bigint | null;
  /** Recipient of a `permitTransferFrom`. */
  to: string | null;
  requestedAmount: bigint | null;
  allowances: Permit2Allowance[];
  /**
   * True when an allowance is `type(uint160).max`, or a transfer amount
   * is `type(uint256).max`.
   */
  isUnlimited: boolean;
  /**
   * True when an allowance expiration is `type(uint48).max` or a
   * signature deadline is `type(uint256).max`. Expiration `0` means the
   * allowance expires at the current block, so it is not treated as open-ended.
   */
  hasNoExpiry: boolean;
};

const APPROVE_SELECTOR = '87517c45'; // keccak256('approve(address,address,uint160,uint48)')
const APPROVE_SIGNATURE = 'approve(address,address,uint160,uint48)';

const PERMIT_SELECTOR = '2b67b570'; // keccak256('permit(address,((address,uint160,uint48,uint48),address,uint256),bytes)')
const PERMIT_SIGNATURE =
  'permit(address,((address,uint160,uint48,uint48),address,uint256),bytes)';

const PERMIT_BATCH_SELECTOR = '2a2d80d1'; // keccak256('permit(address,((address,uint160,uint48,uint48)[],address,uint256),bytes)')
const PERMIT_BATCH_SIGNATURE =
  'permit(address,((address,uint160,uint48,uint48)[],address,uint256),bytes)';

const PERMIT_TRANSFER_SELECTOR = '30f28b7a'; // keccak256('permitTransferFrom(((address,uint256),uint256,uint256),(address,uint256),address,bytes)')
const PERMIT_TRANSFER_SIGNATURE =
  'permitTransferFrom(((address,uint256),uint256,uint256),(address,uint256),address,bytes)';

/** Human-readable ABI signature for each Permit2 variant. */
export const PERMIT2_SIGNATURES: Readonly<Record<Permit2Variant, string>> =
  Object.freeze({
    approve: APPROVE_SIGNATURE,
    permit: PERMIT_SIGNATURE,
    permit_batch: PERMIT_BATCH_SIGNATURE,
    permit_transfer_from: PERMIT_TRANSFER_SIGNATURE,
  });

function parseUintBits(word: string, bits: number, signature: string): bigint {
  const value = parseUint256FromWord(word);
  const max = (1n << BigInt(bits)) - 1n;
  if (value > max) {
    throw new Error(`Invalid uint${bits} in ${signature}`);
  }
  return value;
}

function parseUint160(word: string, signature: string): bigint {
  return parseUintBits(word, 160, signature);
}

function parseUint48(word: string, signature: string): bigint {
  return parseUintBits(word, 48, signature);
}

function wordAt(paramsHex: string, index: number, signature: string): string {
  const start = index * 64;
  if (paramsHex.length < start + 64) {
    throw new Error(`Data too short for ${signature}`);
  }
  return paramsHex.slice(start, start + 64);
}

function byteOffsetToIndex(offset: bigint, signature: string): number {
  if (offset < 0n || offset % 32n !== 0n) {
    throw new Error(`Invalid ABI offset in ${signature}`);
  }
  const index = Number(offset / 32n);
  if (!Number.isSafeInteger(index)) {
    throw new Error(`Invalid ABI offset in ${signature}`);
  }
  return index;
}

function hasOpenDeadline(deadline: bigint | null): boolean {
  return deadline != null && deadline === MAX_UINT256;
}

function hasOpenExpiration(expiration: bigint | null): boolean {
  return expiration != null && expiration === MAX_UINT48;
}

function isUnlimitedAllowance(amount: bigint): boolean {
  return amount === MAX_UINT160;
}

/**
 * Decode Permit2 `approve(token, spender, amount, expiration)`, or null
 * when the selector does not match. `amount == type(uint160).max` is an
 * unlimited allowance. `expiration == type(uint48).max` never expires;
 * `expiration == 0` expires at the current block.
 */
export function decodePermit2Approve(data: string): Permit2Decoded | null {
  const words = matchSelectorWords(data, APPROVE_SELECTOR, 4, APPROVE_SIGNATURE);
  if (!words) return null;
  const token = parseAddressFromWord(words[0]!);
  const spender = parseAddressFromWord(words[1]!);
  const amount = parseUint160(words[2]!, APPROVE_SIGNATURE);
  const expiration = parseUint48(words[3]!, APPROVE_SIGNATURE);
  return {
    method: 'permit2',
    variant: 'approve',
    owner: null,
    spender,
    token,
    amount,
    expiration,
    deadline: null,
    nonce: null,
    to: null,
    requestedAmount: null,
    allowances: [{ token, amount, expiration, nonce: null }],
    isUnlimited: isUnlimitedAllowance(amount),
    hasNoExpiry: hasOpenExpiration(expiration),
  };
}

/**
 * Decode Permit2 `permit(owner, PermitSingle, signature)`, or null when
 * the selector does not match. The signature bytes are not verified: that
 * needs the Permit2 domain separator and is left to the contract.
 */
export function decodePermit2Permit(data: string): Permit2Decoded | null {
  const words = matchSelectorWords(data, PERMIT_SELECTOR, 8, PERMIT_SIGNATURE);
  if (!words) return null;
  const owner = parseAddressFromWord(words[0]!);
  const token = parseAddressFromWord(words[1]!);
  const amount = parseUint160(words[2]!, PERMIT_SIGNATURE);
  const expiration = parseUint48(words[3]!, PERMIT_SIGNATURE);
  const nonce = parseUint48(words[4]!, PERMIT_SIGNATURE);
  const spender = parseAddressFromWord(words[5]!);
  const deadline = parseUint256FromWord(words[6]!);
  return {
    method: 'permit2',
    variant: 'permit',
    owner,
    spender,
    token,
    amount,
    expiration,
    deadline,
    nonce,
    to: null,
    requestedAmount: null,
    allowances: [{ token, amount, expiration, nonce }],
    isUnlimited: isUnlimitedAllowance(amount),
    hasNoExpiry: hasOpenExpiration(expiration) || hasOpenDeadline(deadline),
  };
}

/**
 * Decode Permit2 `permit(owner, PermitBatch, signature)`, or null when
 * the selector does not match. Throws on a truncated or malformed payload.
 */
export function decodePermit2PermitBatch(data: string): Permit2Decoded | null {
  const hex = normalizeCalldataHex(data);
  if (hex.length < 8) return null;
  if (hex.slice(0, 8) !== PERMIT_BATCH_SELECTOR) return null;
  const params = hex.slice(8);
  const sig = PERMIT_BATCH_SIGNATURE;
  const owner = parseAddressFromWord(wordAt(params, 0, sig));
  const batchIndex = byteOffsetToIndex(parseUint256FromWord(wordAt(params, 1, sig)), sig);
  const detailsRel = parseUint256FromWord(wordAt(params, batchIndex, sig));
  const spender = parseAddressFromWord(wordAt(params, batchIndex + 1, sig));
  const deadline = parseUint256FromWord(wordAt(params, batchIndex + 2, sig));
  const detailsIndex = batchIndex + byteOffsetToIndex(detailsRel, sig);
  const length = parseUint256FromWord(wordAt(params, detailsIndex, sig));
  if (length > 32n) {
    throw new Error(`Permit2 batch too large in ${sig}`);
  }
  if (length === 0n) {
    throw new Error(`Permit2 batch is empty in ${sig}`);
  }
  const count = Number(length);
  const allowances: Permit2Allowance[] = [];
  for (let i = 0; i < count; i++) {
    const base = detailsIndex + 1 + i * 4;
    allowances.push({
      token: parseAddressFromWord(wordAt(params, base, sig)),
      amount: parseUint160(wordAt(params, base + 1, sig), sig),
      expiration: parseUint48(wordAt(params, base + 2, sig), sig),
      nonce: parseUint48(wordAt(params, base + 3, sig), sig),
    });
  }
  const first = allowances[0]!;
  return {
    method: 'permit2',
    variant: 'permit_batch',
    owner,
    spender,
    token: first.token,
    amount: first.amount,
    expiration: first.expiration,
    deadline,
    nonce: first.nonce,
    to: null,
    requestedAmount: null,
    allowances,
    isUnlimited: allowances.some((item) => isUnlimitedAllowance(item.amount)),
    hasNoExpiry:
      hasOpenDeadline(deadline) ||
      allowances.some((item) => hasOpenExpiration(item.expiration)),
  };
}

/**
 * Decode Permit2 `permitTransferFrom`, or null when the selector does
 * not match. The signed `permitted.amount` is the cap; `requestedAmount`
 * is what this submission pulls.
 */
export function decodePermit2PermitTransferFrom(
  data: string
): Permit2Decoded | null {
  const words = matchSelectorWords(
    data,
    PERMIT_TRANSFER_SELECTOR,
    8,
    PERMIT_TRANSFER_SIGNATURE
  );
  if (!words) return null;
  const token = parseAddressFromWord(words[0]!);
  const amount = parseUint256FromWord(words[1]!);
  const nonce = parseUint256FromWord(words[2]!);
  const deadline = parseUint256FromWord(words[3]!);
  const to = parseAddressFromWord(words[4]!);
  const requestedAmount = parseUint256FromWord(words[5]!);
  const owner = parseAddressFromWord(words[6]!);
  return {
    method: 'permit2',
    variant: 'permit_transfer_from',
    owner,
    spender: null,
    token,
    amount,
    expiration: null,
    deadline,
    nonce,
    to,
    requestedAmount,
    allowances: [],
    isUnlimited: amount === MAX_UINT256 || requestedAmount === MAX_UINT256,
    hasNoExpiry: hasOpenDeadline(deadline),
  };
}

/** Try each Permit2 ABI. Returns null when no selector matches. */
export function decodePermit2(data: string): Permit2Decoded | null {
  return (
    decodePermit2Approve(data) ??
    decodePermit2Permit(data) ??
    decodePermit2PermitBatch(data) ??
    decodePermit2PermitTransferFrom(data)
  );
}

/** Risk id for a Permit2 allowance or signature that never expires. */
export const PERMIT2_NO_EXPIRY_RISK = 'permit2_no_expiry';

/** `[PERMIT2_NO_EXPIRY_RISK]` when the grant never expires, otherwise empty. */
export function permit2ExpiryRisks(decoded: Permit2Decoded): string[] {
  return decoded.hasNoExpiry ? [PERMIT2_NO_EXPIRY_RISK] : [];
}

/** True when an on-chain Permit2 `approve` grants `type(uint160).max`. */
export function permit2UnlimitedApproval(decoded: Permit2Decoded): boolean {
  return decoded.variant === 'approve' && decoded.isUnlimited;
}

/** True when a signed Permit2 call grants an unlimited amount. */
export function permit2UnlimitedPermit(decoded: Permit2Decoded): boolean {
  return decoded.variant !== 'approve' && decoded.isUnlimited;
}
