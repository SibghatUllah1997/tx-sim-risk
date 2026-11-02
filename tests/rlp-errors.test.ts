import { describe, it, expect } from 'vitest';
import { rlpDecodeItem } from '../src/evm/rlp';

describe('RLP error paths', () => {
  it('throws on short read for malformed long-string header', () => {
    // 0xb9 => long string with length-of-length = 2, but provide no bytes
    expect(() => rlpDecodeItem('b9', 0)).toThrow(/short read/i);
  });

  it('throws on list length mismatch', () => {
    // Construct a list that claims length 2 but contains 1 byte of payload
    // 0xc2 = list of length 2, followed by '00' (one byte) => mismatch
    expect(() => rlpDecodeItem('c200', 0)).toThrow(/short read|list length mismatch/i);
  });
});

