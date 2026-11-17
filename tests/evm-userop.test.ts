import { describe, it, expect } from 'vitest';
import { encodeFunctionData, parseAbi, pad, toHex, type Hex } from 'viem';
import { MAX_UINT256 } from '../src/evm/hex';
import {
  HANDLE_OPS_SIGNATURES,
  MAX_USER_OPS,
  decodeHandleOps,
  paymasterFromAndData,
  unwrapAccountCalls,
} from '../src/evm/userOp';

const SENDER = '0x1111111111111111111111111111111111111111';
const TOKEN = '0xcccccccccccccccccccccccccccccccccccccccc';
const SPENDER = '0x7a250d5630b4cf539739df2c5dacb4c659f2488d';
const BENEFICIARY = '0x2222222222222222222222222222222222222222';
const PAYMASTER = '0x3333333333333333333333333333333333333333';
const SIGNATURE: Hex = `0x${'ab'.repeat(65)}`;

const APPROVE_ABI = parseAbi([
  'function approve(address spender, uint256 value)',
]);
const EXECUTE_ABI = parseAbi([
  'function execute(address dest, uint256 value, bytes func)',
]);
const EXECUTE_BATCH_V06_ABI = parseAbi([
  'function executeBatch(address[] dest, bytes[] func)',
]);
const EXECUTE_BATCH_V07_ABI = parseAbi([
  'function executeBatch((address target, uint256 value, bytes data)[] calls)',
]);
const HANDLE_OPS_V06_ABI = parseAbi([
  'function handleOps((address sender, uint256 nonce, bytes initCode, bytes callData, uint256 callGasLimit, uint256 verificationGasLimit, uint256 preVerificationGas, uint256 maxFeePerGas, uint256 maxPriorityFeePerGas, bytes paymasterAndData, bytes signature)[] ops, address beneficiary)',
]);
const HANDLE_OPS_V07_ABI = parseAbi([
  'function handleOps((address sender, uint256 nonce, bytes initCode, bytes callData, bytes32 accountGasLimits, uint256 preVerificationGas, bytes32 gasFees, bytes paymasterAndData, bytes signature)[] ops, address beneficiary)',
]);

function approveCall(amount: bigint): Hex {
  return encodeFunctionData({
    abi: APPROVE_ABI,
    functionName: 'approve',
    args: [SPENDER, amount],
  });
}

function executeCall(dest: string, value: bigint, func: Hex): Hex {
  return encodeFunctionData({
    abi: EXECUTE_ABI,
    functionName: 'execute',
    args: [dest as Hex, value, func],
  });
}

function packUint128Pair(high: bigint, low: bigint): Hex {
  return pad(toHex((high << 128n) | low), { size: 32 });
}

function v06Op(overrides: Partial<{
  callData: Hex;
  paymasterAndData: Hex;
  nonce: bigint;
}> = {}) {
  return {
    sender: SENDER,
    nonce: overrides.nonce ?? 4n,
    initCode: '0x' as Hex,
    callData: overrides.callData ?? executeCall(TOKEN, 0n, approveCall(100n)),
    callGasLimit: 80_000n,
    verificationGasLimit: 90_000n,
    preVerificationGas: 21_000n,
    maxFeePerGas: 30n,
    maxPriorityFeePerGas: 2n,
    paymasterAndData: overrides.paymasterAndData ?? ('0x' as Hex),
    signature: SIGNATURE,
  };
}

function handleOpsV06(
  ops: ReturnType<typeof v06Op>[],
  beneficiary = BENEFICIARY
): Hex {
  return encodeFunctionData({
    abi: HANDLE_OPS_V06_ABI,
    functionName: 'handleOps',
    args: [ops, beneficiary],
  });
}

function v07Op(overrides: Partial<{
  callData: Hex;
  paymasterAndData: Hex;
}> = {}) {
  return {
    sender: SENDER,
    nonce: 8n,
    initCode: '0x' as Hex,
    callData: overrides.callData ?? approveCall(1n),
    accountGasLimits: packUint128Pair(91_000n, 81_000n),
    preVerificationGas: 22_000n,
    gasFees: packUint128Pair(3n, 40n),
    paymasterAndData: overrides.paymasterAndData ?? ('0x' as Hex),
    signature: SIGNATURE,
  };
}

function handleOpsV07(ops: ReturnType<typeof v07Op>[]): Hex {
  return encodeFunctionData({
    abi: HANDLE_OPS_V07_ABI,
    functionName: 'handleOps',
    args: [ops, BENEFICIARY],
  });
}

describe('paymasterFromAndData', () => {
  it('reads the first 20 bytes and ignores empty or short payloads', () => {
    expect(paymasterFromAndData('0x')).toBeNull();
    expect(paymasterFromAndData(PAYMASTER)).toBe(PAYMASTER);
    expect(paymasterFromAndData(`${PAYMASTER}abcd`)).toBe(PAYMASTER);
    expect(paymasterFromAndData('0x1234')).toBeNull();
  });
});

describe('unwrapAccountCalls', () => {
  it('unwraps execute and both executeBatch layouts', () => {
    const inner = approveCall(7n);
    expect(unwrapAccountCalls(executeCall(TOKEN, 5n, inner))).toEqual([
      { target: TOKEN, value: 5n, data: inner },
    ]);

    const batch06 = encodeFunctionData({
      abi: EXECUTE_BATCH_V06_ABI,
      functionName: 'executeBatch',
      args: [[TOKEN, SPENDER], [inner, approveCall(1n)]],
    });
    expect(unwrapAccountCalls(batch06)).toEqual([
      { target: TOKEN, value: 0n, data: inner },
      { target: SPENDER, value: 0n, data: approveCall(1n) },
    ]);

    const batch07 = encodeFunctionData({
      abi: EXECUTE_BATCH_V07_ABI,
      functionName: 'executeBatch',
      args: [[{ target: TOKEN, value: 9n, data: inner }]],
    });
    expect(unwrapAccountCalls(batch07)).toEqual([
      { target: TOKEN, value: 9n, data: inner },
    ]);
  });

  it('returns the raw payload when callData is not an execute wrapper', () => {
    const inner = approveCall(MAX_UINT256);
    expect(unwrapAccountCalls(inner)).toEqual([
      { target: null, value: 0n, data: inner },
    ]);
    expect(unwrapAccountCalls('0x')).toEqual([
      { target: null, value: 0n, data: '0x' },
    ]);
  });

  it('throws on truncated execute calldata', () => {
    const full = executeCall(TOKEN, 0n, approveCall(1n));
    expect(() => unwrapAccountCalls(full.slice(0, 18))).toThrow(
      /Malformed arguments for execute\(address,uint256,bytes\)/
    );
  });
});

describe('decodeHandleOps', () => {
  it('exposes both EntryPoint signatures', () => {
    expect(HANDLE_OPS_SIGNATURES['v0.6']).toContain('handleOps(');
    expect(HANDLE_OPS_SIGNATURES['v0.7']).toContain('bytes32');
  });

  it('returns null for a non-matching selector', () => {
    expect(decodeHandleOps(approveCall(1n))).toBeNull();
    expect(decodeHandleOps('0x')).toBeNull();
  });

  it('throws on invalid hex', () => {
    expect(() => decodeHandleOps('0xzz')).toThrow(/Invalid hex data/);
  });

  it('decodes a v0.6 op, including execute-wrapped calldata and a paymaster', () => {
    const inner = approveCall(100n);
    const callData = executeCall(TOKEN, 0n, inner);
    const paymasterAndData = `${PAYMASTER}aabb` as Hex;
    const data = handleOpsV06([v06Op({ callData, paymasterAndData })]);
    const decoded = decodeHandleOps(data)!;
    expect(decoded.version).toBe('v0.6');
    expect(decoded.beneficiary).toBe(BENEFICIARY);
    expect(decoded.ops).toHaveLength(1);
    const op = decoded.ops[0]!;
    expect(op.sender).toBe(SENDER);
    expect(op.nonce).toBe(4n);
    expect(op.callGasLimit).toBe(80_000n);
    expect(op.verificationGasLimit).toBe(90_000n);
    expect(op.maxFeePerGas).toBe(30n);
    expect(op.maxPriorityFeePerGas).toBe(2n);
    expect(op.paymaster).toBe(PAYMASTER);
    expect(op.innerCalls).toEqual([
      { target: TOKEN, value: 0n, data: inner },
    ]);
  });

  it('decodes a v0.7 packed op and unpacks the gas words', () => {
    const decoded = decodeHandleOps(handleOpsV07([v07Op()]))!;
    expect(decoded.version).toBe('v0.7');
    const op = decoded.ops[0]!;
    expect(op.verificationGasLimit).toBe(91_000n);
    expect(op.callGasLimit).toBe(81_000n);
    expect(op.maxPriorityFeePerGas).toBe(3n);
    expect(op.maxFeePerGas).toBe(40n);
    expect(op.paymaster).toBeNull();
    expect(op.innerCalls[0]?.data).toBe(approveCall(1n));
  });

  it('rejects an empty batch and one above the cap', () => {
    const empty = handleOpsV06([]);
    expect(() => decodeHandleOps(empty)).toThrow(/no user operations/);

    const tooMany = handleOpsV06(
      Array.from({ length: MAX_USER_OPS + 1 }, () => v06Op())
    );
    expect(() => decodeHandleOps(tooMany)).toThrow(/batch too large/);
  });

  it('throws when the selector matches but the payload is truncated', () => {
    const full = handleOpsV06([v06Op()]);
    expect(() => decodeHandleOps(full.slice(0, 24))).toThrow(
      /Malformed arguments for handleOps/
    );
  });
});
