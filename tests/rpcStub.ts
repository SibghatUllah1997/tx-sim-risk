import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export type RpcCall = { method: string; params: unknown[] };

export type RpcStub = {
  url: string;
  calls: RpcCall[];
  close: () => Promise<void>;
};

export type RpcHandler = (call: RpcCall) =>
  | { result: unknown }
  | { error: { code: number; message: string; data?: string } };

/** Error(string) revert payload, ABI-encoded by hand for the test fixture. */
export function errorStringRevert(message: string): string {
  const bytes = Buffer.from(message, 'utf8');
  const len = bytes.length.toString(16).padStart(64, '0');
  const body = bytes.toString('hex').padEnd(Math.ceil(bytes.length / 32) * 64, '0');
  return `0x08c379a0${'20'.padStart(64, '0')}${len}${body}`;
}

/** Local JSON-RPC server on 127.0.0.1 that records every request. */
export async function startRpcStub(handler: RpcHandler): Promise<RpcStub> {
  const calls: RpcCall[] = [];
  const server: Server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const msg = JSON.parse(body) as { id: number; method: string; params?: unknown[] };
      const call = { method: msg.method, params: msg.params ?? [] };
      calls.push(call);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, ...handler(call) }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    calls,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
