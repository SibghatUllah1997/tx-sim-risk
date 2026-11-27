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
- [x] Day 29: Polish docs, comments, and code quality
- [x] Day 30: Tag v0.1.0 and write release notes

### Phase 2

More decoders and report formats, still one small shippable step per day. Default analysis stays offline. Use existing audited libraries (`viem`, `@solana/web3.js`) and do not hand-roll cryptography.

- [x] Day 31: Decode EIP-2612 `permit` and DAI-style permit, and flag unlimited permit allowances
- [x] Day 32: Decode Uniswap Permit2 `approve` / `permit` / `permitTransferFrom` and surface spender and expiration risks
- [x] Day 33: Decode `multicall` / `multicall3` and recursively analyze inner calls for the same risks
- [x] Day 34: Parse ERC-4337 UserOperation fields and flag a paymaster or a callData approval
- [x] Day 35: Parse EIP-7702 authorization lists on type-4 transactions and flag broad delegate designations
- [x] Day 36: Decode native ETH value transfers (empty vs non-empty calldata) and flag surprise contract calls with value
- [x] Day 37: Add a known-router / bridge / token label catalog so reports can name common spenders
- [x] Day 38: Decode Solana SPL token Transfer / TransferChecked / SetAuthority and flag authority changes
- [x] Day 39: Optional live `eth_call` simulation behind an explicit RPC flag, keeping the default fully offline
- [x] Day 40: Add SARIF output so CI can annotate findings on a pull request
- [x] Day 41: Add a tx diff mode that compares two inputs and highlights new spenders, amounts, and risks
- [x] Day 42: Tag a v0.2.0 release with notes covering Permit2, multicall, and account-abstraction coverage

### Phase 3

More nested envelopes after v0.2.0. Default analysis stays offline. Use existing audited libraries (`viem`, `@solana/web3.js`) and do not hand-roll cryptography.

- [x] Day 43: Decode Gnosis Safe `execTransaction` / `execTransactionFromModule` and recursively analyze inner calldata
- [x] Day 44: Flag Safe `DELEGATECALL`, grants hidden inside the envelope, and unsigned or phishing-listed targets
- [x] Day 45: Decode Uniswap Universal Router `execute` commands and recursively analyze inner Permit2 grants and sub-plans
- [x] Day 46: Flag Permit2 grants hidden inside `execute`, and sweeps/unwraps to phishing-listed recipients
- [x] Day 47: Decode Cow Protocol GPv2Settlement `settle` / `setPreSignature` / `invalidateOrder` and recursively analyze inner interactions
- [x] Day 48: Flag CowSwap grants hidden inside interactions, and trades/interactions targeting phishing-listed addresses
- [x] Day 49: Decode 1inch Aggregation Router `swap` / `unoswapTo` / `clipperSwapTo` (and WithPermit variants) and recursively analyze inner executor calldata and attached permits
- [x] Day 50: Flag 1inch grants hidden inside the envelope, and swaps targeting phishing-listed recipients
- [x] Day 51: Decode 0x Exchange Proxy `transformERC20` / `executeMetaTransaction` (and V2) / `fillLimitOrder` / `fillRfqOrder` / `fillOtcOrder` and recursively analyze inner transformer data and meta-tx calldata
- [x] Day 52: Flag 0x grants hidden inside the envelope, and fills targeting phishing-listed takers or fee recipients

### Phase 4

Marketplace fills after the aggregator envelopes. Default analysis stays offline. Use existing audited libraries (`viem`, `@solana/web3.js`) and do not hand-roll cryptography.

- [x] Day 53: Decode Seaport `fulfillOrder` / `fulfillAdvancedOrder` / `fulfillBasicOrder` (and the efficient basic-order selector) and recursively analyze advanced-order extraData
- [x] Day 54: Flag grants hidden inside extraData, and considerations / additional recipients targeting phishing-listed addresses
- [ ] Day 55: Decode LooksRare V2 `executeTakerAsk` / `executeTakerBid` / `executeMultipleTakerBids` and recursively analyze `additionalParameters`
- [ ] Day 56: Flag grants hidden inside `additionalParameters`, and recipients / affiliates targeting phishing-listed addresses
