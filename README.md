### tx-sim-risk — Explain what an Ethereum transaction will do, fast

[![CI](https://github.com/SibghatUllah1997/tx-sim-risk/actions/workflows/ci.yml/badge.svg)](https://github.com/SibghatUllah1997/tx-sim-risk/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

One-liner: A tiny CLI and TypeScript library that decodes common ERC-20 calls and surfaces simple risk hints (like unlimited approvals) from raw calldata or full raw transactions.

Why it matters:
- Wallets often show hex data. It’s easy to miss risky approvals or burns.
- Quick, deterministic decoding helps reviewers and infra build guardrails before signing.

Features:
- Decode ERC-20 approve, transfer, increaseAllowance, decreaseAllowance
- Decode ERC-721 / ERC-1155 setApprovalForAll and flag operator grants
- Flag unlimited approvals, burns to the zero address, phishing spenders, and grants to EOAs
- Classify spenders/operators as EOA, contract, or unknown (bytecode or known-contract map)
- Human-readable reason strings for each risk id (JSON `riskDetails` and CLI footer)
- Offline simulation stub for token-balance and allowance deltas (`--from` names the sender)
- JSON report mode for downstream tooling
- Parse EIP-1559 fee fields and chainId from raw transactions (legacy and type-2)
- Address checksum utilities
- Batteries-included tests and GitHub Actions CI

Install
- Requirements: Node.js 18+ and npm
- Setup: `npm ci`
- Build (for CLI binary in dist): `npm run build`

Quick CLI demo
```bash
# JSON report for an unlimited ERC-20 approval (risk: unlimited_approval)
node dist/cli.js --json 0x095ea7b30000000000000000000000000000000000000000000000000000000000000000ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff
```

Example output:
```json
{
  "type": "erc20_approve",
  "payload": {
    "spender": "0x0000000000000000000000000000000000000000",
    "amount": "115792089237316195423570985008687907853269984665640564039457584007913129639935",
    "isUnlimitedApproval": true,
    "spenderKind": "unknown"
  },
  "risks": ["unlimited_approval"],
  "riskDetails": [
    {
      "id": "unlimited_approval",
      "reason": "The spender is approved for the maximum uint256 amount, so it can move the holder's entire token balance until the allowance is revoked."
    }
  ],
  "simulation": {
    "balances": [],
    "allowances": [
      {
        "owner": "caller",
        "spender": "0x0000000000000000000000000000000000000000",
        "mode": "set",
        "delta": null,
        "newValue": "115792089237316195423570985008687907853269984665640564039457584007913129639935",
        "wouldRevert": false
      }
    ],
    "operators": [],
    "notes": []
  }
}
```

Architecture
```mermaid
flowchart TD
    A[CLI input\nhex calldata or raw tx] --> B{Raw tx?}
    B -- yes --> C[unwrap data + chainId]
    B -- no --> D[use calldata as-is]
    C --> E[ERC-20 / NFT decoders]
    D --> E[ERC-20 / NFT decoders]
    E --> F[Risk rules\n(unlimited approval,\nzero-address burn,\nNFT approve-all,\nphishing spender,\napproval to EOA)]
    F --> R[Reason strings]
    E --> S[Simulation stub\n(balance / allowance deltas)]
    R --> G[Plain text stdout]
    R --> H[JSON report (--json)]
    S --> G
    S --> H
```

Testing
- `npm test` runs unit tests with Vitest
- CI: see the badge above for the latest status

Roadmap
- See `ROADMAP.md`

License
- MIT — see `LICENSE`

