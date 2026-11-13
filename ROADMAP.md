### 30-day Roadmap

- [x] Day 1: Repo scaffolding, CI, initial EVM approve decoder + tests
- [x] Day 2: CLI scaffold to load hex tx input and print analysis
- [x] Day 3: Add ERC-20 transfer decoder and basic risk checks
- [x] Day 4: Add support for increaseAllowance/decreaseAllowance detection
- [x] Day 5: Introduce simple JSON report format
- [x] Day 6: Add address checksum validation utilities
- [x] Day 7: Implement gas/fee parsing from raw tx (EIP-1559)
- [x] Day 8: Support Trezor/Ledger-style raw tx input parsing
- [x] Day 9: Integrate chainId handling (EIP-155)
- [x] Day 10: Add ERC-721 approveAll detection
- [x] Day 11: Add ERC-1155 setApprovalForAll detection
- [x] Day 12: Risk rule: approvals to known phishing addresses list
- [x] Day 13: Risk rule: approvals to EOAs vs contract addresses
- [x] Day 14: Add human-readable reason strings for each risk
- [x] Day 15: Implement basic simulation stub (balance/allowance deltas)
- [x] Day 16: Add viem-based ABI decoding for common ERC ABIs
- [x] Day 17: Add config-driven allow/block lists
- [x] Day 18: Add output severities (info/warn/high)
- [x] Day 19: Add HTML report renderer
- [x] Day 20: Add GitHub Pages publishing for sample reports
- [x] Day 21: Wire simple Solana tx skeleton parsing (web3.js)
- [x] Day 22: Add Solana associated token account detection
- [x] Day 23: Risk rule: Solana CPI to suspicious program IDs
- [x] Day 24: Add plugin interface for new chain decoders
- [x] Day 25: Add E2E tests for CLI flows
- [x] Day 26: Add example dataset and fixtures
- [x] Day 27: Add JSON schema for report output
- [x] Day 28: Add README examples and screenshots
- [ ] Day 29: Polish docs, comments, and code quality
- [ ] Day 30: Tag v0.1.0 and write release notes

### Phase 2

More decoders and report formats, still one small shippable step per day. Default analysis stays offline. Use existing audited libraries (`viem`, `@solana/web3.js`) and do not hand-roll cryptography.

- [ ] Day 31: Decode EIP-2612 `permit` and DAI-style permit, and flag unlimited permit allowances
- [ ] Day 32: Decode Uniswap Permit2 `approve` / `permit` / `permitTransferFrom` and surface spender and expiration risks
- [ ] Day 33: Decode `multicall` / `multicall3` and recursively analyze inner calls for the same risks
- [ ] Day 34: Parse ERC-4337 UserOperation fields and flag a paymaster or a callData approval
- [ ] Day 35: Parse EIP-7702 authorization lists on type-4 transactions and flag broad delegate designations
- [ ] Day 36: Decode native ETH value transfers (empty vs non-empty calldata) and flag surprise contract calls with value
- [ ] Day 37: Add a known-router / bridge / token label catalog so reports can name common spenders
- [ ] Day 38: Decode Solana SPL token Transfer / TransferChecked / SetAuthority and flag authority changes
- [ ] Day 39: Optional live `eth_call` simulation behind an explicit RPC flag, keeping the default fully offline
- [ ] Day 40: Add SARIF output so CI can annotate findings on a pull request
- [ ] Day 41: Add a tx diff mode that compares two inputs and highlights new spenders, amounts, and risks
- [ ] Day 42: Tag a v0.2.0 release with notes covering Permit2, multicall, and account-abstraction coverage
