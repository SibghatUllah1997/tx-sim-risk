import { describe, it, expect } from 'vitest';
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from '@solana/web3.js';
import {
  createDecoderRegistry,
  defineChainDecoder,
} from '../src/plugins';
import {
  DEFAULT_DECODER_REGISTRY,
  EVM_DECODER,
  SOLANA_DECODER,
  formatReportFooter,
  generateJsonReportFromAny,
  pluginDecodeReport,
  type JsonReport,
} from '../src/report';
import { renderHtmlReport } from '../src/html';
import { UNLIMITED_APPROVAL_RISK } from '../src/risks';

function pad32(hexNoPrefix: string): string {
  return hexNoPrefix.padStart(64, '0');
}

function encodeApprove(spenderNo0x: string, amountHex: string): string {
  return `0x095ea7b3${pad32(`000000000000000000000000${spenderNo0x}`)}${pad32(amountHex)}`;
}

const ROUTER = '7a250d5630b4cf539739df2c5dacb4c659f2488d';

function demoPlugin(id = 'demo') {
  return defineChainDecoder<JsonReport>({
    id,
    name: 'Demo chain',
    tryDecode(input) {
      if (!input.startsWith('demo:')) return null;
      return pluginDecodeReport(
        { id, name: 'Demo chain' },
        {
          summary: input.slice('demo:'.length) || 'empty',
          fields: { raw: input },
        }
      );
    },
  });
}

describe('defineChainDecoder', () => {
  it('freezes a valid plugin and rejects empty or ugly ids', () => {
    const plugin = defineChainDecoder({
      id: 'cosmos',
      name: 'Cosmos',
      tryDecode: () => null,
    });
    expect(Object.isFrozen(plugin)).toBe(true);
    expect(plugin.id).toBe('cosmos');
    expect(() => defineChainDecoder({ id: '', name: 'x', tryDecode: () => null })).toThrow(
      /lowercase slug/i
    );
    expect(() =>
      defineChainDecoder({ id: 'EVM', name: 'Ethereum', tryDecode: () => null })
    ).toThrow(/lowercase slug/i);
    expect(() =>
      defineChainDecoder({ id: 'ok', name: '   ', tryDecode: () => null })
    ).toThrow(/non-empty name/i);
  });
});

describe('createDecoderRegistry', () => {
  it('tries plugins in order and rejects an empty or duplicate list', () => {
    const demo = demoPlugin();
    const registry = createDecoderRegistry([demo, EVM_DECODER]);
    expect(registry.list().map((p) => p.id)).toEqual(['demo', 'evm']);
    expect(registry.get('demo')).toBe(demo);
    expect(registry.get('missing')).toBeUndefined();
    expect(registry.decode('demo:ping')?.type).toBe('plugin_decode');
    expect(registry.decode(encodeApprove(ROUTER, '1'))?.type).toBe('erc20_approve');
    expect(registry.decode('not-claimed')).toBeNull();
    expect(() => createDecoderRegistry([])).toThrow(/at least one plugin/i);
    expect(() => createDecoderRegistry([demo, demoPlugin()])).toThrow(
      /duplicate chain decoder plugin id/i
    );
  });
});

describe('built-in decoder plugins', () => {
  it('registers evm then solana on the default registry', () => {
    expect(DEFAULT_DECODER_REGISTRY.list().map((p) => p.id)).toEqual([
      'evm',
      'solana',
    ]);
    expect(DEFAULT_DECODER_REGISTRY.get('evm')).toBe(EVM_DECODER);
    expect(DEFAULT_DECODER_REGISTRY.get('solana')).toBe(SOLANA_DECODER);
  });

  it('still decodes ERC-20 calldata and Solana skeletons through generateJsonReportFromAny', () => {
    const approve = generateJsonReportFromAny(encodeApprove(ROUTER, 'f'.repeat(64)));
    expect(approve?.type).toBe('erc20_approve');
    expect(approve?.risks).toContain(UNLIMITED_APPROVAL_RISK);

    const payer = Keypair.generate();
    const dest = Keypair.generate();
    const tx = new Transaction({
      feePayer: payer.publicKey,
      recentBlockhash: PublicKey.default.toBase58(),
    }).add(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: dest.publicKey,
        lamports: 3,
      })
    );
    tx.sign(payer);
    const solana = generateJsonReportFromAny(
      Buffer.from(tx.serialize()).toString('base64')
    );
    expect(solana?.type).toBe('solana_tx');
  });

  it('lets a custom registry claim input before the built-in plugins', () => {
    const registry = createDecoderRegistry([demoPlugin(), EVM_DECODER]);
    const report = generateJsonReportFromAny('demo:hello', { decoders: registry });
    expect(report).toMatchObject({
      type: 'plugin_decode',
      payload: {
        pluginId: 'demo',
        chain: 'Demo chain',
        summary: 'hello',
        fields: { raw: 'demo:hello' },
      },
      risks: [],
      severity: 'info',
    });
    const footer = formatReportFooter(report!);
    expect(footer).toEqual([
      'Plugin: demo',
      'Chain: Demo chain',
      'Summary: hello',
      'raw: demo:hello',
    ]);
    const html = renderHtmlReport(report!);
    expect(html).toContain('<code>plugin_decode</code>');
    expect(html).toContain('Demo chain');
    expect(html).not.toContain('<script');
  });
});
