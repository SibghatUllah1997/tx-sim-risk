import { afterEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { inject } from 'vitest';
import { loadReportSchema } from '../../src/schema';
import { assertValidReport } from '../../src/schemaValidate';
import { errorStringRevert, startRpcStub, type RpcStub } from '../rpcStub';
import { REPO_ROOT, runCli, type CliResult } from './runCli';
import { approveCalldata, eip1559RawTx, ROUTER, SENDER } from './fixtures';

const TOKEN = `0x${'cc'.repeat(20)}`;
const CALLDATA = approveCalldata(ROUTER, '64');

/** Async spawn so the in-process RPC stub can answer while the CLI runs. */
function runCliAsync(args: readonly string[]): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [inject('cliEntry'), ...args], {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

let stub: RpcStub | undefined;
afterEach(async () => {
  await stub?.close();
  stub = undefined;
});

describe('CLI e2e: --rpc live eth_call', () => {
  it('adds a successful liveCall block to --json output', async () => {
    stub = await startRpcStub(({ method }) =>
      method === 'eth_chainId' ? { result: '0x1' } : { result: `0x${'00'.repeat(31)}01` }
    );
    const out = await runCliAsync([CALLDATA, '--rpc', stub.url, '--to', TOKEN, '--from', SENDER, '--json']);
    expect(out.status).toBe(0);
    const report = JSON.parse(out.stdout);
    expect(report.liveCall).toMatchObject({ status: 'success', to: TOKEN, from: SENDER, block: 'latest' });
    expect(report.risks).toEqual([]);
    assertValidReport(report, loadReportSchema());
  });

  it('prints a reverted raw tx with its reason and the revert risk in text mode', async () => {
    stub = await startRpcStub(({ method }) =>
      method === 'eth_chainId'
        ? { result: '0x1' }
        : { error: { code: 3, message: 'execution reverted', data: errorStringRevert('paused') } }
    );
    const out = await runCliAsync([eip1559RawTx(CALLDATA), '--rpc', stub.url, '--block', '100']);
    expect(out.status).toBe(0);
    expect(out.stdout).toContain('Risks: live_call_reverted');
    expect(out.stdout).toContain('Live eth_call (block 100): reverted (paused)');
    const call = stub.calls.find((c) => c.method === 'eth_call')!;
    expect(call.params[1]).toBe('0x64');
  });

  it('makes no request and adds no liveCall without --rpc', () => {
    const report = JSON.parse(runCli([CALLDATA, '--json']).stdout);
    expect(report.liveCall).toBeUndefined();
  });

  it('exits 1 with a clear error for missing --to or flags without --rpc', () => {
    const noTo = runCli([CALLDATA, '--rpc', 'http://127.0.0.1:9', '--json']);
    expect(noTo.status).toBe(1);
    expect(noTo.stderr).toContain('--to is required');

    const noRpc = runCli([CALLDATA, '--to', TOKEN]);
    expect(noRpc.status).toBe(1);
    expect(noRpc.stderr).toContain('--to and --block need --rpc');
  });
});
