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
