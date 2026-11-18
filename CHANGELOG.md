## 2026-11-18

- Raw EVM transactions now carry their recipient and native value. A raw tx with empty calldata becomes a new `native_transfer` report (chain id, recipient, wei, recipient kind); ETH sent to the zero address, a phishing-listed, or block-listed recipient is flagged.
- New warning `native_value_nonpayable_call` when a raw or type-4 tx attaches ETH to a call the standard defines as non-payable (ERC-20 approve/transfer/allowance, permits, Permit2, setApprovalForAll, `handleOps`). Payable router multicall and unknown ABI calls are not flagged. Any attached value is noted in the simulation.
- The JSON Schema and example dataset (now 35 cases) cover the new report. Marked Day 36 done.

## 2026-11-17

- Decode router `multicall(bytes[])` (plus the deadline and previous-block-hash variants) and Multicall3 `aggregate`, `tryAggregate`, `aggregate3`, `aggregate3Value`, `blockAndAggregate`, and `tryBlockAndAggregate` into a new `multicall` report. Each inner call carries its own nested report, and inner risks roll up to the batch.
- New warnings: `multicall_batched_grant` when an approval, permit, or operator grant sits inside a batch, and `multicall_depth_limit` when batches nest deeper than four levels. Batches over 256 calls are rejected.
- Multicall3 inner calls are simulated against the Multicall3 contract (it is `msg.sender` there); router multicall keeps the signer. The JSON Schema and example dataset cover the new report.
- Parse ERC-4337 EntryPoint `handleOps` (v0.6 and packed v0.7), unwrap account `execute` / `executeBatch`, and flag a paymaster (`erc4337_paymaster`) or a hidden allowance grant in `callData` (`erc4337_calldata_approval`).
- Parse EIP-7702 type-4 authorization lists and flag a delegate designation (`eip7702_delegation`) or an any-chain `chain_id = 0` grant (`eip7702_broad_delegate`). The example dataset now has 33 cases.

## 2026-11-16

- Decode Uniswap Permit2 `approve`, `permit` (single and batch), and `permitTransferFrom` into a `permit2` report. Unlimited amounts (`type(uint160).max` or `type(uint256).max`) reuse the existing high-severity allowance/permit risks, and a never-expiring grant (`type(uint48).max` or a max deadline) adds the new `permit2_no_expiry` warning. Spenders, and transfer recipients, get the same phishing, block-list, and EOA checks as `approve`.
- The simulation records a Permit2 allowance against the signing owner (or the submitter for on-chain `approve`) and treats `permitTransferFrom` as a pull from the owner to the recipient. The JSON Schema and example dataset (now 27 cases) cover the new report.
- Expiration `0` is not treated as open-ended: Permit2 expires that allowance at the current block.

## 2026-11-13

- Decode EIP-2612 `permit` and DAI-style `permit` calls into a new `erc20_permit` report (owner, spender, value, deadline/expiry, nonce, `allowed`). An unlimited permit (max uint256, or DAI `allowed = true`) raises the high-severity `unlimited_permit` risk, and the spender gets the same phishing, block-list, and EOA checks as `approve`.
- The simulation records the permit's allowance against the signing owner rather than `--from`, since a relayer often submits someone else's permit. The JSON Schema and example dataset (now 23 cases) cover the new report.
- Shared ABI word parsing and CLI payload checks so decoder errors stay consistent, and added `--help` / `--version`.
- Plain-text analysis is built by a testable formatter; address checksums reuse the same hex helpers.
- Marked Days 29–30 done and published v0.1.0 release notes.

## 2026-11-12

- JSON reports now have a published JSON Schema (`schema/report.schema.json`). `tx-sim-risk --schema` prints it, a library validator checks extra keys and type mismatches, and every example dataset case is tested against it.
- README includes worked CLI examples plus terminal screenshots generated from the dataset (`docs/examples/`; refresh with `npm run examples`).
- Added a labelled example dataset (`examples/dataset/cases.json`): 19 EVM and Solana inputs (calldata, raw txs, base64 Solana txs), each with its expected report type, risks, and severity.
- The dataset is built from code with fixed keys and placeholder signatures, so `npm run dataset` regenerates it byte for byte; a test fails if the file drifts.
- New `loadDataset` / `checkDataset` helpers validate the file and diff every case against the decoders; E2E tests replay each case through the real CLI.

## 2026-11-11

- Added end-to-end CLI tests that build the CLI once and run it as a real process across text, JSON, HTML, stdin, raw-tx, Solana, and error flows, checking stdout, stderr, and exit codes.
- `--fees` now reads unsigned EIP-1559 transactions (9 fields) as well as signed ones; it used to reject them even though calldata unwrapping accepted them.
- Flag Solana transactions that invoke, or can cross-program-invoke into, a program on the built-in suspicious program-id list (`solana_suspicious_cpi`). Hits show up in JSON, CLI, and HTML reports.
- Added a chain-decoder plugin interface and registry. EVM and Solana run as built-in plugins; extra chains can register and return a `plugin_decode` report without changing the host.

## 2026-11-10

- Detect Solana associated token account instructions (create, createIdempotent, recoverNested) and check each named account against its derived address; a mismatch raises a `solana_ata_mismatch` warning in JSON, CLI, and HTML reports.
- Built a catalog of sample decoded calls and a script-free HTML gallery you can regenerate with `npm run pages`.
- Added a GitHub Pages workflow that publishes those sample reports from the main branch.
- Parse Solana legacy and v0 transaction skeletons from hex or base64, and include them in JSON, CLI, and HTML reports.

## 2026-11-09

- Added config-driven allow and block lists (`--config`) so grants to blocked spenders are flagged and trusted EOAs skip the approval-to-EOA heuristic.
- Reports now carry an info/warn/high severity for each risk and for the report as a whole, in JSON and in the CLI footer.
- Added an HTML report renderer and a `--html` CLI flag that prints a standalone, script-free page with every value escaped.

## 2026-11-05

- Added a human-readable reason string for every risk id, shown in JSON reports and the CLI footer.
- Added an offline simulation stub that estimates token-balance and allowance deltas from decoded calldata.
- JSON reports and CLI output now include those deltas; pass `--from` to name the sender instead of `caller`.
- Added viem-based ABI decoding for common ERC-20/721/1155 calls (transferFrom, safeTransferFrom, batch transfers, ...). They now appear as `abi_call` in JSON reports and in CLI output.

## 2026-11-04

- Flag token and NFT approval grants whose spender or operator is on the built-in phishing address list.
- Classify spenders as EOA, contract, or unknown, and flag grants that target an EOA.
- CLI text output now prints spender/operator kind and the collected risk ids.

## 2026-11-03

- Added ERC-721 setApprovalForAll decoding and an approve-all risk flag when an operator grant is enabled.
- Added ERC-1155 setApprovalForAll detection (same ABI selector) with a matching approve-all risk flag.
- CLI text output and JSON reports now surface NFT operator approvals for both standards.

## 2026-11-02

- Added support for parsing full hardware-wallet raw transactions (EIP-1559 and legacy), unwrapping calldata for analysis.
- Integrated chainId handling (EIP-155) and exposed it via a new `--chainId` CLI flag.
- JSON reports can now be generated directly from raw tx hex via an unwrapping helper.

## 2026-11-01

- Added EIP-55 address checksum utilities with unit tests, plus refactored shared hex/address helpers.
- Implemented EIP-1559 (type-2) gas/fee parsing and a new `--fees` CLI flag to print limits and max fees from raw transactions.

## 2026-10-31

- Added ERC-20 increaseAllowance/decreaseAllowance decoders with tests, and integrated them into the CLI.
- Introduced a simple JSON report generator with a new `--json` CLI flag.

### 2026-10-30

- Added a simple CLI to load hex EVM tx input and print analysis.
- Implemented ERC-20 transfer decoder and a basic burn-address risk flag.
- Updated the roadmap to mark Days 2–3 complete.

### Day 1

- Initialized TypeScript project with Vitest and CI.
- Added ERC-20 approval decoder and unlimited-approval risk flag with tests.
- Wrote README, LICENSE, ROADMAP; first green test run.

