# tx-sim-risk v0.2.0

Second tagged release. The theme is "what is this transaction really
granting?" for the patterns that hide approvals: signatures instead of
on-chain approves, batches, and smart accounts. Analysis is still offline by
default; the only network path is the opt-in `--rpc` call.

## New coverage

- **Permits.** EIP-2612 and DAI-style `permit` decode into an `erc20_permit`
  report. Unlimited permits raise `unlimited_permit`, and the simulation books
  the allowance against the signing owner, not whoever relays it.
- **Permit2.** Uniswap Permit2 `approve`, `permit` (single and batch), and
  `permitTransferFrom`. Unlimited amounts reuse the allowance risks and a
  never-expiring grant adds `permit2_no_expiry`.
- **Multicall.** Router `multicall(bytes[])` variants and every Multicall3
  `aggregate*` entry point. Inner calls get their own nested report, risks
  roll up to the batch, and a grant tucked inside a batch adds
  `multicall_batched_grant`. Nesting stops at four levels.
- **Account abstraction.** ERC-4337 `handleOps` (v0.6 and packed v0.7) with
  account `execute` / `executeBatch` unwrapped; a paymaster or an approval in
  `callData` is flagged. EIP-7702 type-4 authorization lists flag delegate
  designations and any-chain (`chain_id = 0`) grants.
- **Native value.** Raw txs with empty calldata become `native_transfer`
  reports, and ETH attached to a non-payable token or wallet call raises
  `native_value_nonpayable_call`.
- **Solana SPL.** Transfer, TransferChecked, and SetAuthority are decoded;
  changing or clearing an authority raises `solana_authority_change`.
- **Labels.** Common routers, bridges, and tokens are named next to spenders,
  recipients, operators, and delegates.

## New output modes

- `--rpc <url>` runs an optional live `eth_call` (chain id is checked first,
  revert reasons are decoded). Nothing touches the network without it.
- `--sarif` emits SARIF 2.1.0 for pull-request annotations.
- `--diff` compares two payloads and lists new spenders, amounts, and risks.
- `npm run release:check` verifies the version matches across the manifest,
  lockfile, README, these notes, and the changelog before tagging.

## Compatibility

Existing report types keep their shape; new types and the optional
`liveCall` block are covered by `schema/report.schema.json`. The lockfile
previously carried a stale `1.0.0` version and is now aligned with the
package. Still pre-1.0, so treat undocumented fields as unstable.

# tx-sim-risk v0.1.0

First tagged release of the CLI and TypeScript library. Analysis is offline by
default: hex calldata, raw EVM transactions, and serialized Solana transactions
are decoded locally and scored with deterministic risk rules.

## What it does

- Decode common ERC-20 calls (`approve`, `transfer`, `increaseAllowance`,
  `decreaseAllowance`) plus ERC-721 / ERC-1155 `setApprovalForAll`.
- Unwrap hardware-wallet raw transactions (legacy and EIP-1559), including
  chain id and fee fields.
- Flag unlimited approvals, burns to the zero address, phishing spenders,
  grants to EOAs, config-driven block lists, NFT approve-all, and Solana
  associated-token mismatches or suspicious program ids.
- Emit JSON reports (with a published schema), plain text, or script-free HTML.
- Parse Solana legacy and v0 skeletons. Extra chains can register through the
  decoder plugin interface.

## How to run it

```bash
npm ci
npm run build
npx tx-sim-risk --help
npx tx-sim-risk --json 0x095ea7b3…
```

Node.js 18 or newer. See the README for worked examples, and
`examples/dataset/cases.json` for the labelled regression corpus.

## Compatibility

This is an early 0.1.0. JSON report shapes are covered by
`schema/report.schema.json`; treat undocumented fields as unstable.
