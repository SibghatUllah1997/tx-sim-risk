import {
  MAX_UINT256,
  matchSelectorWords,
  parseAddressFromWord,
  parseBoolFromWord,
  parseUint256FromWord,
} from './hex';

/** Which permit ABI the calldata used. */
export type PermitVariant = 'eip2612' | 'dai';

/**
 * A decoded ERC-20 permit. Both variants are folded into one shape so the
 * risk rules and the simulation do not need to care which ABI was used.
 */
export type Erc20PermitDecoded = {
  method: 'erc20_permit';
  variant: PermitVariant;
  /** Token holder whose signature authorises the allowance. */
  owner: string;
  spender: string;
  /**
   * Allowance the permit sets. For DAI-style permits this is MAX_UINT256
   * when `allowed` is true and zero when it is false.
   */
  value: bigint;
  /** EIP-2612 `deadline` or DAI `expiry`, in unix seconds. */
  deadline: bigint;
  /** Signed nonce. Only the DAI ABI carries it in calldata. */
  nonce: bigint | null;
  /** DAI `allowed` flag; null for EIP-2612. */
  allowed: boolean | null;
  isUnlimitedPermit: boolean;
  /**
   * True when the signature never expires: DAI treats `expiry == 0` as
   * "no expiry", and an EIP-2612 deadline of MAX_UINT256 is never reached.
   */
  hasNoExpiry: boolean;
};

const EIP2612_PERMIT_SELECTOR = 'd505accf'; // keccak256('permit(address,address,uint256,uint256,uint8,bytes32,bytes32)')[0..4]
const EIP2612_PERMIT_SIGNATURE =
  'permit(address,address,uint256,uint256,uint8,bytes32,bytes32)';
const DAI_PERMIT_SELECTOR = '8fcbaf0c'; // keccak256('permit(address,address,uint256,uint256,bool,uint8,bytes32,bytes32)')[0..4]
const DAI_PERMIT_SIGNATURE =
  'permit(address,address,uint256,uint256,bool,uint8,bytes32,bytes32)';

/** Human-readable ABI signature for each permit variant. */
export const PERMIT_SIGNATURES: Readonly<Record<PermitVariant, string>> =
  Object.freeze({
    eip2612: EIP2612_PERMIT_SIGNATURE,
    dai: DAI_PERMIT_SIGNATURE,
  });

/**
 * Check that a word holds a valid ABI-encoded uint8. The signature itself
 * is not verified here: that needs the token's domain separator and is
 * left to the token contract.
 */
function assertUint8Word(word: string, signature: string): void {
  if (parseUint256FromWord(word) > 0xffn) {
    throw new Error(`Invalid uint8 v in ${signature}`);
  }
}

/**
 * Decode EIP-2612
 * `permit(owner, spender, value, deadline, v, r, s)`, or null when the
 * selector does not match. Throws on a truncated payload or a bad `v`.
 */
export function decodeEip2612Permit(data: string): Erc20PermitDecoded | null {
  const words = matchSelectorWords(
    data,
    EIP2612_PERMIT_SELECTOR,
    7,
    EIP2612_PERMIT_SIGNATURE
  );
  if (!words) return null;
  assertUint8Word(words[4]!, EIP2612_PERMIT_SIGNATURE);
  const value = parseUint256FromWord(words[2]!);
  const deadline = parseUint256FromWord(words[3]!);
  return {
    method: 'erc20_permit',
    variant: 'eip2612',
    owner: parseAddressFromWord(words[0]!),
    spender: parseAddressFromWord(words[1]!),
    value,
    deadline,
    nonce: null,
    allowed: null,
    isUnlimitedPermit: value === MAX_UINT256,
    hasNoExpiry: deadline === MAX_UINT256,
  };
}

/**
 * Decode DAI-style
 * `permit(holder, spender, nonce, expiry, allowed, v, r, s)`, or null when
 * the selector does not match. `allowed = true` grants an unlimited
 * allowance, so it is reported as a MAX_UINT256 value.
 */
export function decodeDaiPermit(data: string): Erc20PermitDecoded | null {
  const words = matchSelectorWords(
    data,
    DAI_PERMIT_SELECTOR,
    8,
    DAI_PERMIT_SIGNATURE
  );
  if (!words) return null;
  assertUint8Word(words[5]!, DAI_PERMIT_SIGNATURE);
  const allowed = parseBoolFromWord(words[4]!);
  const expiry = parseUint256FromWord(words[3]!);
  return {
    method: 'erc20_permit',
    variant: 'dai',
    owner: parseAddressFromWord(words[0]!),
    spender: parseAddressFromWord(words[1]!),
    value: allowed ? MAX_UINT256 : 0n,
    deadline: expiry,
    nonce: parseUint256FromWord(words[2]!),
    allowed,
    isUnlimitedPermit: allowed,
    hasNoExpiry: expiry === 0n,
  };
}

/** Try both permit ABIs. Returns null when neither selector matches. */
export function decodeErc20Permit(data: string): Erc20PermitDecoded | null {
  return decodeEip2612Permit(data) ?? decodeDaiPermit(data);
}

/** Risk id for a permit that grants the maximum allowance. */
export const UNLIMITED_PERMIT_RISK = 'unlimited_permit';

/** `[UNLIMITED_PERMIT_RISK]` for an unlimited permit, otherwise empty. */
export function unlimitedPermitRisks(permit: Erc20PermitDecoded): string[] {
  return permit.isUnlimitedPermit ? [UNLIMITED_PERMIT_RISK] : [];
}
