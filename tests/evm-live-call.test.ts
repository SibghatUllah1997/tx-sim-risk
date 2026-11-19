import { afterEach, describe, expect, it } from 'vitest';
import { custom } from 'viem';
import {
  LIVE_CALL_REVERTED_RISK,
  decodeRevertReason,
  formatLiveCallLine,
  liveCallRequestFromPayload,
  liveCallRisks,
  parseLiveCallBlock,
  parseRpcUrl,
  runLiveCall,
} from '../src/evm/liveCall';
import { approveCalldata, eip1559RawTx, ROUTER } from './e2e/fixtures';
import { errorStringRevert, startRpcStub, type RpcStub } from './rpcStub';

const TOKEN = `0x${'cc'.repeat(20)}`;
const SENDER = `0x${'11'.repeat(20)}`;
const CALLDATA = approveCalldata(ROUTER, '64');

let stub: RpcStub | undefined;
afterEach(async () => {
  await stub?.close();
  stub = undefined;
});

describe('parseLiveCallBlock and parseRpcUrl', () => {
  it('accepts tags, decimal and hex heights, and defaults to latest', () => {
    expect(parseLiveCallBlock()).toBe('latest');
    expect(parseLiveCallBlock('finalized')).toBe('finalized');
    expect(parseLiveCallBlock('19000000')).toBe(19_000_000n);
    expect(parseLiveCallBlock('0x10')).toBe(16n);
    expect(() => parseLiveCallBlock('yesterday')).toThrow(/--block/);
  });

  it('only allows http and https RPC URLs', () => {
    expect(parseRpcUrl('https://rpc.example.org')).toBe('https://rpc.example.org/');
    expect(() => parseRpcUrl('file:///etc/passwd')).toThrow(/http\(s\)/);
    expect(() => parseRpcUrl('not a url')).toThrow(/http\(s\)/);
  });
});

describe('liveCallRequestFromPayload', () => {
  it('needs --to for bare calldata', () => {
    expect(() => liveCallRequestFromPayload(CALLDATA)).toThrow(/--to is required/);
    const req = liveCallRequestFromPayload(CALLDATA, { to: TOKEN.toUpperCase().replace('0X', '0x'), from: SENDER });
    expect(req).toEqual({ to: TOKEN, data: CALLDATA, value: 0n, block: 'latest', from: SENDER });
  });

  it('takes recipient, value, data, and chain id from a raw tx', () => {
    const req = liveCallRequestFromPayload(eip1559RawTx(CALLDATA, 10), { block: '5' });
    expect(req).toEqual({ to: TOKEN, data: CALLDATA, value: 0n, block: 5n, expectedChainId: 10n });
  });

  it('rejects a --to that disagrees with the raw tx recipient', () => {
    expect(() =>
      liveCallRequestFromPayload(eip1559RawTx(CALLDATA), { to: SENDER })
    ).toThrow(/does not match/);
  });

  it('rejects non-hex input and bad addresses', () => {
    expect(() => liveCallRequestFromPayload('AQID+w==', { to: TOKEN })).toThrow(/EVM hex/);
    expect(() => liveCallRequestFromPayload(CALLDATA, { to: '0x1234' })).toThrow(/--to/);
  });
});

describe('decodeRevertReason', () => {
  it('decodes Error(string) and Panic(uint256), and ignores custom errors', () => {
    expect(decodeRevertReason(errorStringRevert('insufficient allowance'))).toBe('insufficient allowance');
    expect(decodeRevertReason(`0x4e487b71${'11'.padStart(64, '0')}`)).toBe('panic 17');
    expect(decodeRevertReason('0xdeadbeef')).toBeNull();
    expect(decodeRevertReason(null)).toBeNull();
  });
});

describe('runLiveCall', () => {
  it('sends eth_call with to, data, from, value, and block, and returns success', async () => {
    stub = await startRpcStub(({ method }) =>
      method === 'eth_chainId' ? { result: '0x1' } : { result: `0x${'00'.repeat(31)}01` }
    );
    const result = await runLiveCall(stub.url, {
      to: TOKEN,
      data: CALLDATA,
      from: SENDER,
      value: 0n,
      block: 123n,
      expectedChainId: 1n,
    });
    expect(result).toEqual({
      status: 'success',
      to: TOKEN,
      from: SENDER,
      value: '0',
      block: '123',
      chainId: '1',
      returnData: `0x${'00'.repeat(31)}01`,
      revertReason: null,
      error: null,
    });
    const call = stub.calls.find((c) => c.method === 'eth_call')!;
    expect(call.params[0]).toMatchObject({ to: TOKEN, data: CALLDATA, from: SENDER });
    expect(call.params[1]).toBe('0x7b');
    expect(liveCallRisks(result)).toEqual([]);
    expect(formatLiveCallLine(result)).toBe('Live eth_call (block 123): success, 32 bytes returned');
  });

  it('reports a revert with its decoded reason and raises the revert risk', async () => {
    stub = await startRpcStub(({ method }) =>
      method === 'eth_chainId'
        ? { result: '0x1' }
        : { error: { code: 3, message: 'execution reverted', data: errorStringRevert('paused') } }
    );
    const result = await runLiveCall(stub.url, { to: TOKEN, data: CALLDATA, value: 0n, block: 'latest' });
    expect(result.status).toBe('reverted');
    expect(result.revertReason).toBe('paused');
    expect(result.returnData).toBe(errorStringRevert('paused'));
    expect(liveCallRisks(result)).toEqual([LIVE_CALL_REVERTED_RISK]);
    expect(formatLiveCallLine(result)).toBe('Live eth_call (block latest): reverted (paused)');
  });

  it('refuses to call when the RPC is on a different chain than the raw tx', async () => {
    stub = await startRpcStub(() => ({ result: '0x89' }));
    const result = await runLiveCall(stub.url, {
      to: TOKEN,
      data: CALLDATA,
      value: 0n,
      block: 'latest',
      expectedChainId: 1n,
    });
    expect(result.status).toBe('error');
    expect(result.chainId).toBe('137');
    expect(result.error).toMatch(/RPC chain id 137 does not match transaction chain id 1/);
    expect(stub.calls.map((c) => c.method)).toEqual(['eth_chainId']);
  });

  it('turns transport failures into an error result instead of throwing', async () => {
    const transport = custom({
      async request() {
        throw new Error('connection refused');
      },
    });
    const result = await runLiveCall('http://unused', { to: TOKEN, data: CALLDATA, value: 0n, block: 'latest' }, { transport });
    expect(result.status).toBe('error');
    expect(result.error).toBeTruthy();
    expect(liveCallRisks(result)).toEqual([]);
    expect(formatLiveCallLine(result)).toMatch(/^Live eth_call \(block latest\): failed \(/);
  });
});
