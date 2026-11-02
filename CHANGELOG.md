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

