import { describe, it, expect } from 'vitest';
import { encodeFunctionData, parseAbi, type Hex } from 'viem';
import {
  MAX_MULTICALL_CALLS,
  MULTICALL_SIGNATURES,
  decodeMulticall,
} from '../src/evm/multicall';

const TOKEN: Hex = '0xcccccccccccccccccccccccccccccccccccccccc';
const OTHER: Hex = '0xdddddddddddddddddddddddddddddddddddddddd';
const SPENDER: Hex = '0x7a250d5630b4cf539739df2c5dacb4c659f2488d';

const ERC20_ABI = parseAbi([
  'function approve(address spender, uint256 value)',
  'function transfer(address to, uint256 value)',
]);
const BATCH_ABI = parseAbi([
  'function multicall(bytes[] data)',
  'function multicall(uint256 deadline, bytes[] data)',
  'function multicall(bytes32 previousBlockhash, bytes[] data)',
  'function aggregate((address target, bytes callData)[] calls)',
  'function tryAggregate(bool requireSuccess, (address target, bytes callData)[] calls)',
  'function aggregate3((address target, bool allowFailure, bytes callData)[] calls)',
  'function aggregate3Value((address target, bool allowFailure, uint256 value, bytes callData)[] calls)',
  'function blockAndAggregate((address target, bytes callData)[] calls)',
  'function tryBlockAndAggregate(bool requireSuccess, (address target, bytes callData)[] calls)',
]);

const approve = encodeFunctionData({
  abi: ERC20_ABI,
  functionName: 'approve',
  args: [SPENDER, 5n],
});
const transfer = encodeFunctionData({
  abi: ERC20_ABI,
  functionName: 'transfer',
  args: [OTHER, 7n],
});

describe('decodeMulticall', () => {
  it('returns null for unrelated selectors and short input', () => {
    expect(decodeMulticall(approve)).toBeNull();
    expect(decodeMulticall('0x')).toBeNull();
    expect(decodeMulticall('0xac96')).toBeNull();
  });

  it('decodes router multicall(bytes[]) with no target', () => {
    const data = encodeFunctionData({
      abi: BATCH_ABI,
      functionName: 'multicall',
      args: [[approve, transfer]],
    });
    const decoded = decodeMulticall(data)!;
    expect(decoded.variant).toBe('multicall');
    expect(decoded.forwardsAsContract).toBe(false);
    expect(decoded.deadline).toBeNull();
    expect(decoded.calls).toEqual([
      { target: null, data: approve, allowFailure: null, value: null },
      { target: null, data: transfer, allowFailure: null, value: null },
    ]);
    expect(decoded.totalValue).toBe(0n);
  });

  it('keeps the deadline and previous block hash of router variants', () => {
    const withDeadline = decodeMulticall(
      encodeFunctionData({
        abi: BATCH_ABI,
        functionName: 'multicall',
        args: [1_900_000_000n, [approve]],
      })
    )!;
    expect(withDeadline.variant).toBe('multicall_deadline');
    expect(withDeadline.deadline).toBe(1_900_000_000n);

    const hash: Hex = `0x${'ef'.repeat(32)}`;
    const withHash = decodeMulticall(
      encodeFunctionData({
        abi: BATCH_ABI,
        functionName: 'multicall',
        args: [hash, [approve]],
      })
    )!;
    expect(withHash.variant).toBe('multicall_blockhash');
    expect(withHash.previousBlockhash).toBe(hash);
    expect(withHash.calls).toHaveLength(1);
  });

  it('decodes Multicall3 aggregate and blockAndAggregate as strict calls', () => {
    for (const functionName of ['aggregate', 'blockAndAggregate'] as const) {
      const decoded = decodeMulticall(
        encodeFunctionData({
          abi: BATCH_ABI,
          functionName,
          args: [[{ target: TOKEN, callData: approve }]],
        })
      )!;
      expect(decoded.forwardsAsContract).toBe(true);
      expect(decoded.calls).toEqual([
        { target: TOKEN, data: approve, allowFailure: false, value: null },
      ]);
    }
  });

  it('maps requireSuccess=false on tryAggregate to allowFailure=true', () => {
    for (const functionName of ['tryAggregate', 'tryBlockAndAggregate'] as const) {
      const loose = decodeMulticall(
        encodeFunctionData({
          abi: BATCH_ABI,
          functionName,
          args: [false, [{ target: TOKEN, callData: transfer }]],
        })
      )!;
      expect(loose.calls[0]!.allowFailure).toBe(true);
      const strict = decodeMulticall(
        encodeFunctionData({
          abi: BATCH_ABI,
          functionName,
          args: [true, [{ target: TOKEN, callData: transfer }]],
        })
      )!;
      expect(strict.calls[0]!.allowFailure).toBe(false);
    }
  });

  it('decodes aggregate3 and aggregate3Value with per-call flags and value', () => {
    const three = decodeMulticall(
      encodeFunctionData({
        abi: BATCH_ABI,
        functionName: 'aggregate3',
        args: [[
          { target: TOKEN, allowFailure: true, callData: approve },
          { target: OTHER, allowFailure: false, callData: transfer },
        ]],
      })
    )!;
    expect(three.variant).toBe('aggregate3');
    expect(three.calls.map((c) => c.allowFailure)).toEqual([true, false]);

    const withValue = decodeMulticall(
      encodeFunctionData({
        abi: BATCH_ABI,
        functionName: 'aggregate3Value',
        args: [[
          { target: TOKEN, allowFailure: false, value: 3n, callData: '0x' },
          { target: OTHER, allowFailure: false, value: 4n, callData: transfer },
        ]],
      })
    )!;
    expect(withValue.variant).toBe('aggregate3_value');
    expect(withValue.calls.map((c) => c.value)).toEqual([3n, 4n]);
    expect(withValue.calls[0]!.data).toBe('0x');
    expect(withValue.totalValue).toBe(7n);
  });

  it('lowercases checksummed targets', () => {
    const decoded = decodeMulticall(
      encodeFunctionData({
        abi: BATCH_ABI,
        functionName: 'aggregate',
        args: [[{ target: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D', callData: approve }]],
      })
    )!;
    expect(decoded.calls[0]!.target).toBe(SPENDER);
  });

  it('throws on a truncated batch and on an oversized batch', () => {
    const data = encodeFunctionData({
      abi: BATCH_ABI,
      functionName: 'multicall',
      args: [[approve]],
    });
    expect(() => decodeMulticall(data.slice(0, 80))).toThrow(/Malformed multicall\(bytes\[\]\)/);

    const many = Array.from({ length: MAX_MULTICALL_CALLS + 1 }, () => '0x' as Hex);
    const big = encodeFunctionData({
      abi: BATCH_ABI,
      functionName: 'multicall',
      args: [many],
    });
    expect(() => decodeMulticall(big)).toThrow(/limit is 256/);
  });

  it('lists one signature per variant', () => {
    expect(Object.keys(MULTICALL_SIGNATURES)).toHaveLength(9);
    expect(MULTICALL_SIGNATURES.aggregate3).toBe('aggregate3((address,bool,bytes)[])');
  });
});
