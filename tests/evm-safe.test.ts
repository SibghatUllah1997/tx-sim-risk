import { describe, expect, it } from 'vitest';
import { encodeFunctionData, parseAbi, type Hex } from 'viem';
import {
  SAFE_PACKED_SIGNATURE_BYTES,
  SAFE_SIGNATURES,
  decodeSafeExec,
  hasPackedSignatures,
  packedSignatureCount,
} from '../src/evm/safe';

const TOKEN: Hex = '0xcccccccccccccccccccccccccccccccccccccccc';
const SPENDER: Hex = '0x7a250d5630b4cf539739df2c5dacb4c659f2488d';
const ZERO: Hex = '0x0000000000000000000000000000000000000000';
const SIG: Hex = `0x${'ab'.repeat(SAFE_PACKED_SIGNATURE_BYTES)}`;

const ERC20_ABI = parseAbi([
  'function approve(address spender, uint256 value)',
]);
const SAFE_ABI = parseAbi([
  'function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures)',
  'function execTransactionFromModule(address to, uint256 value, bytes data, uint8 operation)',
  'function execTransactionFromModuleReturnData(address to, uint256 value, bytes data, uint8 operation)',
]);

const approve = encodeFunctionData({
  abi: ERC20_ABI,
  functionName: 'approve',
  args: [SPENDER, 5n],
});

function execTransaction(opts: {
  to?: Hex;
  value?: bigint;
  data?: Hex;
  operation?: number;
  signatures?: Hex;
}): Hex {
  return encodeFunctionData({
    abi: SAFE_ABI,
    functionName: 'execTransaction',
    args: [
      opts.to ?? TOKEN,
      opts.value ?? 0n,
      opts.data ?? approve,
      opts.operation ?? 0,
      0n,
      0n,
      0n,
      ZERO,
      ZERO,
      opts.signatures ?? SIG,
    ],
  });
}

describe('decodeSafeExec', () => {
  it('returns null for unrelated selectors and short input', () => {
    expect(decodeSafeExec(approve)).toBeNull();
    expect(decodeSafeExec('0x')).toBeNull();
    expect(decodeSafeExec('0x6a7612')).toBeNull();
  });

  it('rejects non-hex input', () => {
    expect(() => decodeSafeExec('zz')).toThrow(/Invalid hex data/);
  });

  it('decodes execTransaction wrapping an ERC-20 approve', () => {
    const decoded = decodeSafeExec(execTransaction({}))!;
    expect(decoded.method).toBe('safe_exec');
    expect(decoded.variant).toBe('exec_transaction');
    expect(decoded.signature).toBe(SAFE_SIGNATURES.exec_transaction);
    expect(decoded.to).toBe(TOKEN);
    expect(decoded.value).toBe(0n);
    expect(decoded.data).toBe(approve);
    expect(decoded.operation).toBe('call');
    expect(decoded.safeTxGas).toBe(0n);
    expect(decoded.gasToken).toBe(ZERO);
    expect(decoded.refundReceiver).toBe(ZERO);
    expect(decoded.signatures).toBe(SIG);
    expect(hasPackedSignatures(decoded)).toBe(true);
    expect(packedSignatureCount(decoded.signatures)).toBe(1);
  });

  it('decodes a native value transfer (empty inner data)', () => {
    const decoded = decodeSafeExec(
      execTransaction({ data: '0x', value: 1_000n, to: SPENDER })
    )!;
    expect(decoded.data).toBe('0x');
    expect(decoded.value).toBe(1_000n);
    expect(decoded.to).toBe(SPENDER);
  });

  it('decodes DelegateCall operation', () => {
    const decoded = decodeSafeExec(execTransaction({ operation: 1 }))!;
    expect(decoded.operation).toBe('delegatecall');
  });

  it('treats empty signatures as unsigned', () => {
    const decoded = decodeSafeExec(execTransaction({ signatures: '0x' }))!;
    expect(decoded.signatures).toBe('0x');
    expect(hasPackedSignatures(decoded)).toBe(false);
    expect(packedSignatureCount(decoded.signatures)).toBe(0);
  });

  it('decodes both module variants without signature fields', () => {
    const moduleCall = encodeFunctionData({
      abi: SAFE_ABI,
      functionName: 'execTransactionFromModule',
      args: [TOKEN, 7n, approve, 0],
    });
    const fromModule = decodeSafeExec(moduleCall)!;
    expect(fromModule.variant).toBe('module');
    expect(fromModule.signature).toBe(SAFE_SIGNATURES.module);
    expect(fromModule.to).toBe(TOKEN);
    expect(fromModule.value).toBe(7n);
    expect(fromModule.data).toBe(approve);
    expect(fromModule.signatures).toBeNull();
    expect(fromModule.safeTxGas).toBeNull();
    expect(hasPackedSignatures(fromModule)).toBe(false);
    expect(packedSignatureCount(fromModule.signatures)).toBeNull();

    const withReturn = encodeFunctionData({
      abi: SAFE_ABI,
      functionName: 'execTransactionFromModuleReturnData',
      args: [TOKEN, 0n, approve, 1],
    });
    const returned = decodeSafeExec(withReturn)!;
    expect(returned.variant).toBe('module_return_data');
    expect(returned.signature).toBe(SAFE_SIGNATURES.module_return_data);
    expect(returned.operation).toBe('delegatecall');
    expect(returned.signatures).toBeNull();
  });

  it('throws when the selector matches but the payload is truncated', () => {
    expect(() => decodeSafeExec('0x6a7612020001')).toThrow(
      /Malformed arguments for execTransaction/
    );
  });

  it('throws when operation is not Call or DelegateCall', () => {
    expect(() => decodeSafeExec(execTransaction({ operation: 2 }))).toThrow(
      /Malformed arguments for execTransaction/
    );
  });
});
