import { encodeFunctionData, parseAbi } from 'viem';
import { createAddressKindMap } from './evm/addressKind';
import { generateJsonReport, type JsonReport, type ReportOptions } from './report';

function pad32(hexNoPrefix: string): string {
  return hexNoPrefix.padStart(64, '0');
}

function addressWord(addressNo0x: string): string {
  return pad32(`000000000000000000000000${addressNo0x.toLowerCase()}`);
}

function encodeApprove(spenderNo0x: string, amountHex: string): string {
  return `0x095ea7b3${addressWord(spenderNo0x)}${pad32(amountHex)}`;
}

function encodeTransfer(toNo0x: string, amountHex: string): string {
  return `0xa9059cbb${addressWord(toNo0x)}${pad32(amountHex)}`;
}

function encodeIncreaseAllowance(
  spenderNo0x: string,
  amountHex: string
): string {
  return `0x39509351${addressWord(spenderNo0x)}${pad32(amountHex)}`;
}

function encodeDecreaseAllowance(
  spenderNo0x: string,
  amountHex: string
): string {
  return `0xa457c2d7${addressWord(spenderNo0x)}${pad32(amountHex)}`;
}

function encodeSetApprovalForAll(
  operatorNo0x: string,
  approved: boolean
): string {
  return `0xa22cb465${addressWord(operatorNo0x)}${pad32(approved ? '1' : '0')}`;
}

const UNISWAP_V2_ROUTER = '7a250d5630b4cf539739df2c5dacb4c659f2488d';
const PHISHING_DRAINER = 'bad0000000000000000000000000000000000001';
const EOA_SPENDER = '1111111111111111111111111111111111111111';
const RECIPIENT = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

const TRANSFER_FROM_ABI = parseAbi([
  'function transferFrom(address from, address to, uint256 value)',
]);

/**
 * One published sample: hex calldata plus the title/summary shown on the
 * static report gallery. Ids are URL-safe filenames without `.html`.
 */
export type SampleSpec = {
  id: string;
  title: string;
  summary: string;
  input: string;
  options?: ReportOptions;
};

const EOA_KIND_MAP = createAddressKindMap([], [`0x${EOA_SPENDER}`]);

/**
 * Canonical set of decoded calls used to publish sample HTML reports.
 * Keep ids stable: they become public URLs on the report gallery.
 */
export const SAMPLE_SPECS: readonly SampleSpec[] = Object.freeze([
  Object.freeze({
    id: 'unlimited-approval',
    title: 'Unlimited ERC-20 approval',
    summary:
      'approve() with the maximum uint256 amount to a known router contract.',
    input: encodeApprove(UNISWAP_V2_ROUTER, 'f'.repeat(64)),
  }),
  Object.freeze({
    id: 'limited-approval',
    title: 'Limited ERC-20 approval',
    summary: 'approve() for a small finite amount to a known router contract.',
    input: encodeApprove(UNISWAP_V2_ROUTER, '64'),
  }),
  Object.freeze({
    id: 'burn-transfer',
    title: 'Transfer to the zero address',
    summary: 'transfer() that permanently removes tokens from circulation.',
    input: encodeTransfer('0'.repeat(40), '0a'),
  }),
  Object.freeze({
    id: 'plain-transfer',
    title: 'Ordinary ERC-20 transfer',
    summary: 'transfer() to a regular recipient with no extra risk flags.',
    input: encodeTransfer(RECIPIENT, 'ff'),
  }),
  Object.freeze({
    id: 'increase-allowance',
    title: 'Increase ERC-20 allowance',
    summary: 'increaseAllowance() raising a router spend limit by 42 tokens.',
    input: encodeIncreaseAllowance(UNISWAP_V2_ROUTER, '2a'),
  }),
  Object.freeze({
    id: 'decrease-allowance',
    title: 'Decrease ERC-20 allowance',
    summary: 'decreaseAllowance() lowering a router spend limit by 7 tokens.',
    input: encodeDecreaseAllowance(UNISWAP_V2_ROUTER, '07'),
  }),
  Object.freeze({
    id: 'nft-approve-all',
    title: 'NFT setApprovalForAll grant',
    summary:
      'Operator grant that applies to every ERC-721 and ERC-1155 token in the collection.',
    input: encodeSetApprovalForAll(UNISWAP_V2_ROUTER, true),
  }),
  Object.freeze({
    id: 'nft-revoke-all',
    title: 'NFT setApprovalForAll revoke',
    summary: 'Operator revocation; no approve-all risk is raised.',
    input: encodeSetApprovalForAll(UNISWAP_V2_ROUTER, false),
  }),
  Object.freeze({
    id: 'phishing-approval',
    title: 'Approval to a known phishing spender',
    summary:
      'Finite approve() whose spender matches the built-in phishing seed list.',
    input: encodeApprove(PHISHING_DRAINER, '64'),
  }),
  Object.freeze({
    id: 'approval-to-eoa',
    title: 'Approval to an externally owned account',
    summary:
      'Finite approve() whose spender is classified as an EOA rather than a contract.',
    input: encodeApprove(EOA_SPENDER, '64'),
    options: Object.freeze({ addressKinds: EOA_KIND_MAP }),
  }),
  Object.freeze({
    id: 'transfer-from',
    title: 'ERC-20 transferFrom via ABI decode',
    summary:
      'A transferFrom call that has no dedicated risk rule and is reported as abi_call.',
    input: encodeFunctionData({
      abi: TRANSFER_FROM_ABI,
      functionName: 'transferFrom',
      args: [`0x${RECIPIENT}`, `0x${EOA_SPENDER}`, 500n],
    }),
  }),
]);

const SAMPLE_BY_ID: ReadonlyMap<string, SampleSpec> = new Map(
  SAMPLE_SPECS.map((spec) => [spec.id, spec])
);

/** Look up a sample by its stable id, or return undefined. */
export function sampleById(id: string): SampleSpec | undefined {
  return SAMPLE_BY_ID.get(id);
}

/**
 * Decode a sample into a JSON report. Throws if the catalog entry no
 * longer round-trips through the decoder — that is a catalog bug.
 */
export function reportForSample(spec: SampleSpec): JsonReport {
  const report = generateJsonReport(spec.input, spec.options);
  if (!report) {
    throw new Error(`Sample "${spec.id}" did not decode to a supported call`);
  }
  return report;
}
