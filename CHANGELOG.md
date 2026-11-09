## 2026-11-09

- Added config-driven allow and block lists (`--config`) so grants to blocked spenders are flagged and trusted EOAs skip the approval-to-EOA heuristic.
- Reports now carry an info/warn/high severity for each risk and for the report as a whole, in JSON and in the CLI footer.

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

