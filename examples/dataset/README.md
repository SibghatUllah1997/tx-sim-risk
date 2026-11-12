# Example dataset

`cases.json` is a small labelled corpus for tx-sim-risk. Each case has:

- `id`: stable kebab-case name
- `chain`: `evm` or `solana`
- `input`: hex calldata, a raw EVM transaction, or a base64 Solana transaction
- `from` / `config` (optional): values for `--from` and `--config` (path relative to this folder)
- `expect`: the report `type`, ordered `risks`, and overall `severity`

All addresses and keys are fixtures. Solana keys come from fixed seeds and EVM
legacy signatures are placeholders, so nothing here is broadcastable or holds funds.

Do not edit `cases.json` by hand. Change `src/datasetCases.ts` and run
`npm run dataset`; it rewrites the file and fails if any case no longer matches.
