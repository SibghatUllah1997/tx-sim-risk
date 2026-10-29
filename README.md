### tx-sim-risk — Solana/EVM transaction simulator and risk checker

A TypeScript project exploring simple transaction decoding and risk checks on EVM and Solana. Day 1 ships a tiny EVM module that decodes ERC-20 `approve(address,uint256)` calls and flags unlimited approvals.

Educational note: This project is for educational purposes only. It does not constitute financial advice. Always verify results independently before acting on them.

### Quickstart

- Requirements: Node.js 18+ and npm
- Install:
  - `npm install`
- Run tests:
  - `npm test`
- Build:
  - `npm run build`

### What’s here on Day 1

- Minimal EVM decoder for ERC-20 `approve`
- Risk flag for “unlimited” approvals (`uint256` max)
- Vitest tests and GitHub Actions CI
- MIT license and a 30-day roadmap

### License

MIT © HM Sibghat Ullah

