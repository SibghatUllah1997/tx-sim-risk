import { describe, it, expect } from 'vitest';
import { serializeTransaction, type Hex } from 'viem';
import { extractDataAndChainIdFromRawTx } from '../src/evm/rawtx';

const TO: Hex = `0x${'4b'.repeat(20)}`;
const SIG = {
  r: `0x${'11'.repeat(32)}` as Hex,
  s: `0x${'22'.repeat(32)}` as Hex,
};

describe('raw tx recipient and value', () => {
  it('reads to and value from an EIP-1559 transfer with empty calldata', () => {
    const raw = serializeTransaction({
      type: 'eip1559',
      chainId: 1,
      nonce: 3,
      gas: 21_000n,
      maxPriorityFeePerGas: 1n,
      maxFeePerGas: 2n,
      to: TO,
      value: 1_500_000_000_000_000_000n,
    });
    const parsed = extractDataAndChainIdFromRawTx(raw)!;
    expect(parsed.txType).toBe('eip1559');
    expect(parsed.to).toBe(TO);
    expect(parsed.value).toBe(1_500_000_000_000_000_000n);
    expect(parsed.data).toBe('0x');
  });

  it('reads value from a signed legacy EIP-155 transaction', () => {
    const raw = serializeTransaction(
      {
        type: 'legacy',
        chainId: 10,
        nonce: 0,
        gas: 21_000n,
        gasPrice: 1n,
        to: TO,
        value: 7n,
      },
      { ...SIG, v: 10n * 2n + 35n }
    );
    const parsed = extractDataAndChainIdFromRawTx(raw)!;
    expect(parsed.txType).toBe('legacy');
    expect(parsed.chainId).toBe(10n);
    expect(parsed.to).toBe(TO);
    expect(parsed.value).toBe(7n);
  });

  it('returns a null recipient for contract creation', () => {
    const raw = serializeTransaction({
      type: 'eip1559',
      chainId: 1,
      nonce: 0,
      gas: 100_000n,
      maxPriorityFeePerGas: 1n,
      maxFeePerGas: 2n,
      value: 0n,
      data: '0x6000',
    });
    const parsed = extractDataAndChainIdFromRawTx(raw)!;
    expect(parsed.to).toBeNull();
    expect(parsed.value).toBe(0n);
    expect(parsed.data).toBe('0x6000');
  });

  it('rejects an EIP-1559 recipient that is not 20 bytes', () => {
    // [chainId=1, nonce=0, tip=1, maxFee=2, gas=21000, to=19 bytes, value=1, data, accessList]
    const fields = `01800102825208` + `93${'4b'.repeat(19)}` + `0180c0`;
    const raw = `0x02${(0xc0 + fields.length / 2).toString(16)}${fields}`;
    expect(() => extractDataAndChainIdFromRawTx(raw)).toThrow(/20 bytes/);
  });

  it('carries the type-4 recipient and value through', () => {
    const raw = serializeTransaction({
      type: 'eip7702',
      chainId: 1,
      nonce: 1,
      gas: 50_000n,
      maxPriorityFeePerGas: 1n,
      maxFeePerGas: 2n,
      to: TO,
      value: 9n,
      authorizationList: [
        { chainId: 1, address: `0x${'aa'.repeat(20)}`, nonce: 0, yParity: 1, ...SIG },
      ],
    });
    const parsed = extractDataAndChainIdFromRawTx(raw)!;
    expect(parsed.txType).toBe('eip7702');
    expect(parsed.to).toBe(TO);
    expect(parsed.value).toBe(9n);
  });
});
