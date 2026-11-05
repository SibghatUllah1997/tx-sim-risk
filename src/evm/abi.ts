import { decodeFunctionData, parseAbi, toFunctionSelector } from 'viem';
import type { AbiFunction } from 'viem';
import { isHexString, stripHexPrefix } from './hex';

export type AbiStandard = 'erc20' | 'erc721' | 'erc1155';

/**
 * Human-readable signatures for the state-changing functions we recognise,
 * grouped by the standard that defines them. Signatures that appear in more
 * than one standard (for example approve and transferFrom) share a selector
 * and are merged into a single entry below.
 */
const SIGNATURES_BY_STANDARD: Record<AbiStandard, readonly string[]> = {
  erc20: [
    'function transfer(address to, uint256 value)',
    'function transferFrom(address from, address to, uint256 value)',
    'function approve(address spender, uint256 value)',
    'function increaseAllowance(address spender, uint256 addedValue)',
    'function decreaseAllowance(address spender, uint256 subtractedValue)',
  ],
  erc721: [
    'function approve(address to, uint256 tokenId)',
    'function transferFrom(address from, address to, uint256 tokenId)',
    'function safeTransferFrom(address from, address to, uint256 tokenId)',
    'function safeTransferFrom(address from, address to, uint256 tokenId, bytes data)',
    'function setApprovalForAll(address operator, bool approved)',
  ],
  erc1155: [
    'function safeTransferFrom(address from, address to, uint256 id, uint256 value, bytes data)',
    'function safeBatchTransferFrom(address from, address to, uint256[] ids, uint256[] values, bytes data)',
    'function setApprovalForAll(address operator, bool approved)',
  ],
};

type CatalogEntry = {
  item: AbiFunction;
  selector: string;
  standards: AbiStandard[];
};

function buildCatalog(): Map<string, CatalogEntry> {
  const bySelector = new Map<string, CatalogEntry>();
  for (const standard of Object.keys(SIGNATURES_BY_STANDARD) as AbiStandard[]) {
    for (const text of SIGNATURES_BY_STANDARD[standard]) {
      const item = parseAbi([text])[0] as AbiFunction;
      const selector = toFunctionSelector(item);
      const existing = bySelector.get(selector);
      if (existing) {
        // Same selector means the same canonical signature; only the
        // parameter names differ between standards. Keep the first item.
        existing.standards.push(standard);
      } else {
        bySelector.set(selector, { item, selector, standards: [standard] });
      }
    }
  }
  return bySelector;
}

const CATALOG = buildCatalog();
const CATALOG_ABI: readonly AbiFunction[] = [...CATALOG.values()].map(
  (entry) => entry.item
);

export type AbiArgValue = string | boolean | AbiArgValue[];

export type AbiDecodedArg = {
  name: string;
  type: string;
  value: AbiArgValue;
};

export type AbiDecoded = {
  method: 'abi_call';
  functionName: string;
  /** Canonical signature, e.g. `transfer(address,uint256)`. */
  signature: string;
  selector: string;
  /** Standards that define this selector; more than one when it is shared. */
  standards: AbiStandard[];
  args: AbiDecodedArg[];
};

/** Canonical `name(type,type)` form of an ABI function item. */
function canonicalSignature(item: AbiFunction): string {
  return `${item.name}(${item.inputs.map((input) => input.type).join(',')})`;
}

/**
 * Make a decoded value safe to print and to put in JSON: bigints become
 * decimal strings and addresses are lower-cased to match the other decoders.
 */
function normalizeValue(type: string, value: unknown): AbiArgValue {
  if (Array.isArray(value)) {
    const inner = type.slice(0, type.lastIndexOf('['));
    return value.map((entry) => normalizeValue(inner, entry));
  }
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    return type === 'address' ? value.toLowerCase() : value;
  }
  throw new Error(`Unexpected decoded value for type ${type}`);
}

/**
 * Decode calldata against the common ERC-20 / ERC-721 / ERC-1155 function
 * set using viem's ABI decoder.
 *
 * Returns null when the selector is not in the set. Throws when the
 * selector is known but the arguments are malformed (for example truncated).
 */
export function decodeCommonAbi(data: string): AbiDecoded | null {
  if (!isHexString(data)) {
    throw new Error('Invalid hex data');
  }
  const hex = stripHexPrefix(data).toLowerCase();
  if (hex.length < 8) return null;
  const selector = `0x${hex.slice(0, 8)}`;
  const entry = CATALOG.get(selector);
  if (!entry) return null;

  let decoded;
  try {
    decoded = decodeFunctionData({
      abi: CATALOG_ABI,
      data: `0x${hex}`,
    });
  } catch {
    throw new Error(`Malformed arguments for ${canonicalSignature(entry.item)}`);
  }

  const values = (decoded.args ?? []) as readonly unknown[];
  const args = entry.item.inputs.map((input, index) => ({
    name: input.name ?? `arg${index}`,
    type: input.type,
    value: normalizeValue(input.type, values[index]),
  }));

  return {
    method: 'abi_call',
    functionName: entry.item.name,
    signature: canonicalSignature(entry.item),
    selector,
    standards: [...entry.standards],
    args,
  };
}

/** Every signature the decoder knows about, for docs and tests. */
export function knownAbiSignatures(): string[] {
  return [...CATALOG.values()].map((entry) => canonicalSignature(entry.item));
}
