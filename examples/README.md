## Real-world examples

This folder contains raw Ethereum mainnet transactions (as hex) to demo the CLI and library:

- `rawtx-usdt-approve-unlimited.txt` — ERC-20 `approve` with unlimited allowance (type-2)
- `rawtx-usdt-approve-zero.txt` — ERC-20 `approve(spender, 0)` revoke (legacy)
- `rawtx-uniswap-swap-v2.txt` — Uniswap V2 `swapExactTokensForTokens`

You can run the CLI on any of them:

```bash
node dist/cli.js --json "$(cat examples/rawtx-usdt-approve-unlimited.txt)"
```

