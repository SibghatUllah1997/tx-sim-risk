import { isHexString } from './evm/hex';

/** Shortest base64 blob we treat as a serialized Solana transaction. */
export const MIN_BASE64_PAYLOAD_LENGTH = 64;

const BASE64_BODY = /^[A-Za-z0-9+/]+={0,2}$/;

export type CliInputKind = 'hex' | 'base64' | 'invalid-hex' | 'empty' | 'other';

export type ClassifiedCliInput =
  | { kind: 'hex'; value: string }
  | { kind: 'base64'; value: string }
  | { kind: 'invalid-hex'; value: string }
  | { kind: 'empty' }
  | { kind: 'other'; value: string };

function looksLikeHexPrefix(input: string): boolean {
  return input.startsWith('0x') || input.startsWith('0X');
}

/** True when `input` is even-length 0x-prefixed hexadecimal. */
export function isHexPayload(input: string | null | undefined): input is string {
  if (!input) return false;
  const trimmed = input.trim();
  return looksLikeHexPrefix(trimmed) && isHexString(trimmed);
}

/**
 * True when `input` looks like a base64-serialized Solana transaction:
 * alphabet-only, optional padding, and long enough to hold a real message.
 */
export function isBase64Payload(
  input: string | null | undefined
): input is string {
  if (!input) return false;
  const trimmed = input.trim();
  return trimmed.length >= MIN_BASE64_PAYLOAD_LENGTH && BASE64_BODY.test(trimmed);
}

/** True when `input` is hex calldata/raw-tx or a base64 Solana transaction. */
export function isPayloadLike(input: string | null | undefined): input is string {
  return isHexPayload(input) || isBase64Payload(input);
}

/**
 * Classify a CLI token or stdin blob. `0x` followed by non-hex is
 * `invalid-hex` so the CLI can error instead of treating it as usage.
 */
export function classifyCliInput(input: string | null | undefined): ClassifiedCliInput {
  if (input == null) return { kind: 'empty' };
  const value = input.trim();
  if (!value) return { kind: 'empty' };
  if (looksLikeHexPrefix(value)) {
    if (isHexString(value)) return { kind: 'hex', value };
    return { kind: 'invalid-hex', value };
  }
  if (isBase64Payload(value)) return { kind: 'base64', value };
  return { kind: 'other', value };
}
