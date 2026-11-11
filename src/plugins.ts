/**
 * Chain decoder plugins turn raw input (hex calldata, a raw EVM tx, a
 * serialized Solana tx, or a future encoding) into a report, or return
 * null when the bytes are not this plugin's chain.
 *
 * Plugins are tried in registry order; the first non-null result wins.
 * Keep `tryDecode` fast and side-effect free on foreign input.
 */

const ID_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;

export type ChainDecoderPlugin<TReport = unknown> = {
  /** Stable slug used in registries and `plugin_decode` reports. */
  id: string;
  /** Human-readable chain or decoder name. */
  name: string;
  /**
   * Attempt to decode `input`. Return null quickly when the encoding is
   * not this chain's; do not throw on well-formed but unrecognized bytes.
   */
  tryDecode(input: string, options?: unknown): TReport | null;
};

export type DecoderRegistry<TReport = unknown> = {
  /** Plugins in the order they are tried. */
  list(): readonly ChainDecoderPlugin<TReport>[];
  /** Look up a plugin by id, or undefined when it is not registered. */
  get(id: string): ChainDecoderPlugin<TReport> | undefined;
  /** First non-null `tryDecode` result, or null when no plugin claims input. */
  decode(input: string, options?: unknown): TReport | null;
};

/**
 * Validate and freeze a plugin descriptor. Ids must be lowercase slugs
 * so they are safe as report fields and filenames.
 */
export function defineChainDecoder<TReport>(
  plugin: ChainDecoderPlugin<TReport>
): ChainDecoderPlugin<TReport> {
  const id = plugin.id.trim();
  const name = plugin.name.trim();
  if (!ID_PATTERN.test(id)) {
    throw new Error(
      `Chain decoder plugin id must be a lowercase slug: ${plugin.id}`
    );
  }
  if (!name) {
    throw new Error('Chain decoder plugin requires a non-empty name');
  }
  if (typeof plugin.tryDecode !== 'function') {
    throw new Error(`Chain decoder plugin "${id}" is missing tryDecode`);
  }
  if (plugin.id === id && plugin.name === name && Object.isFrozen(plugin)) {
    return plugin;
  }
  return Object.freeze({
    id,
    name,
    tryDecode: plugin.tryDecode,
  });
}

/**
 * Build an immutable registry. Duplicate ids and an empty plugin list
 * throw so a misconfigured host fails at construction, not at decode time.
 */
export function createDecoderRegistry<TReport>(
  plugins: readonly ChainDecoderPlugin<TReport>[]
): DecoderRegistry<TReport> {
  if (plugins.length === 0) {
    throw new Error('Decoder registry requires at least one plugin');
  }
  const seen = new Set<string>();
  const frozen = plugins.map((plugin) => {
    const defined = defineChainDecoder(plugin);
    if (seen.has(defined.id)) {
      throw new Error(`Duplicate chain decoder plugin id: ${defined.id}`);
    }
    seen.add(defined.id);
    return defined;
  });
  return Object.freeze({
    list: () => frozen,
    get(id: string) {
      return frozen.find((plugin) => plugin.id === id);
    },
    decode(input: string, options?: unknown) {
      for (const plugin of frozen) {
        const result = plugin.tryDecode(input, options);
        if (result != null) return result;
      }
      return null;
    },
  });
}
