import { describe, it, expect } from 'vitest';
import {
  MIN_BASE64_PAYLOAD_LENGTH,
  classifyCliInput,
  isBase64Payload,
  isHexPayload,
  isPayloadLike,
} from '../src/payload';

const APPROVE =
  '0x095ea7b30000000000000000000000007a250d5630b4cf539739df2c5dacb4c659f2488d' +
  '0000000000000000000000000000000000000000000000000000000000000001';

describe('classifyCliInput', () => {
  it('accepts 0x-prefixed even-length hex, including empty 0x', () => {
    expect(classifyCliInput(APPROVE)).toEqual({ kind: 'hex', value: APPROVE });
    expect(classifyCliInput('  0xab  ')).toEqual({ kind: 'hex', value: '0xab' });
    expect(classifyCliInput('0XAB')).toEqual({ kind: 'hex', value: '0XAB' });
    expect(isHexPayload(APPROVE)).toBe(true);
    expect(isPayloadLike('0x')).toBe(true);
  });

  it('flags 0x followed by non-hex or odd-length data as invalid-hex', () => {
    expect(classifyCliInput('0xzzzz')).toEqual({
      kind: 'invalid-hex',
      value: '0xzzzz',
    });
    expect(classifyCliInput('0xabc')).toEqual({
      kind: 'invalid-hex',
      value: '0xabc',
    });
    expect(isHexPayload('0xzzzz')).toBe(false);
    expect(isPayloadLike('0xzzzz')).toBe(false);
  });

  it('accepts long alphabet-only base64 and rejects short or noisy strings', () => {
    const body = 'A'.repeat(MIN_BASE64_PAYLOAD_LENGTH);
    expect(classifyCliInput(body)).toEqual({ kind: 'base64', value: body });
    expect(isBase64Payload(body + '==')).toBe(true);
    expect(isBase64Payload('A'.repeat(MIN_BASE64_PAYLOAD_LENGTH - 1))).toBe(
      false
    );
    expect(isBase64Payload(`${body}!`)).toBe(false);
    expect(classifyCliInput('hello')).toEqual({ kind: 'other', value: 'hello' });
    expect(classifyCliInput('   ')).toEqual({ kind: 'empty' });
    expect(classifyCliInput(null)).toEqual({ kind: 'empty' });
  });
});
