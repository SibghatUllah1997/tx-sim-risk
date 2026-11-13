import { encodeFunctionData, parseAbi, serializeTransaction, type Hex } from 'viem';
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { DATASET_VERSION, type Dataset, type DatasetCase } from './dataset';
import { SEED_DRAINER_PROGRAM_ID } from './solana/programs';

// Addresses are illustrative. The router matches the allow list in
// examples/risk-lists.json and the drainer matches the built-in phishing seed.
const ROUTER = '7a250d5630b4cf539739df2c5dacb4c659f2488d';
const PHISHING_DRAINER = 'bad0000000000000000000000000000000000001';
const BLOCKED = 'badc0ffee0000000000000000000000000000001';
const RECIPIENT = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const SENDER = '0x1111111111111111111111111111111111111111';
const MAX_UINT = 'f'.repeat(64);
const TX_TARGET: Hex = `0x${'cc'.repeat(20)}`;

/** Allow/block list used by config cases, relative to examples/dataset/. */
const RISK_LISTS = '../risk-lists.json';

function word(hexNoPrefix: string): string {
  return hexNoPrefix.padStart(64, '0');
}

function selectorCall(selector: string, address: string, value: string): Hex {
  return `0x${selector}${word(address.toLowerCase())}${word(value)}`;
}

const approve = (spender: string, amount: string) =>
  selectorCall('095ea7b3', spender, amount);
const transfer = (to: string, amount: string) =>
  selectorCall('a9059cbb', to, amount);
const increaseAllowance = (spender: string, amount: string) =>
  selectorCall('39509351', spender, amount);
const decreaseAllowance = (spender: string, amount: string) =>
  selectorCall('a457c2d7', spender, amount);
const setApprovalForAll = (operator: string, approved: boolean) =>
  selectorCall('a22cb465', operator, approved ? '1' : '0');

const PERMIT_SIG_R: Hex = `0x${'ab'.repeat(32)}`;
const PERMIT_SIG_S: Hex = `0x${'cd'.repeat(32)}`;
const PERMIT_DEADLINE = 1_900_000_000n;

const EIP2612_PERMIT_ABI = parseAbi([
  'function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)',
]);
const DAI_PERMIT_ABI = parseAbi([
  'function permit(address holder, address spender, uint256 nonce, uint256 expiry, bool allowed, uint8 v, bytes32 r, bytes32 s)',
]);

/** EIP-2612 permit with a placeholder signature (never valid on-chain). */
function eip2612Permit(spender: string, value: bigint): Hex {
  return encodeFunctionData({
    abi: EIP2612_PERMIT_ABI,
    functionName: 'permit',
    args: [SENDER, `0x${spender}`, value, PERMIT_DEADLINE, 27, PERMIT_SIG_R, PERMIT_SIG_S],
  });
}

/** DAI-style permit with a placeholder signature (never valid on-chain). */
function daiPermit(spender: string, allowed: boolean): Hex {
  return encodeFunctionData({
    abi: DAI_PERMIT_ABI,
    functionName: 'permit',
    args: [SENDER, `0x${spender}`, 0n, 0n, allowed, 28, PERMIT_SIG_R, PERMIT_SIG_S],
  });
}

const TRANSFER_FROM_ABI = parseAbi([
  'function transferFrom(address from, address to, uint256 value)',
]);

function eip1559Tx(data: Hex, chainId: number): Hex {
  return serializeTransaction({
    type: 'eip1559',
    chainId,
    nonce: 7,
    gas: 60_000n,
    maxPriorityFeePerGas: 2_000_000_000n,
    maxFeePerGas: 30_000_000_000n,
    to: TX_TARGET,
    value: 0n,
    data,
  });
}

/** Legacy EIP-155 tx with a fixed placeholder signature (never broadcast). */
function legacyTx(data: Hex, chainId: number): Hex {
  return serializeTransaction(
    {
      type: 'legacy',
      chainId,
      nonce: 1,
      gas: 60_000n,
      gasPrice: 10_000_000_000n,
      to: TX_TARGET,
      value: 0n,
      data,
    },
    {
      r: `0x${'11'.repeat(32)}`,
      s: `0x${'22'.repeat(32)}`,
      v: BigInt(chainId * 2 + 35),
    }
  );
}

/**
 * Deterministic Solana key from a label. Ed25519 signatures are
 * deterministic too, so the serialized transactions never change.
 * These keys are throwaway fixtures and must never hold funds.
 */
function fixtureKey(label: string): Keypair {
  const seed = Buffer.alloc(32);
  Buffer.from(`tx-sim-risk:${label}`, 'utf8').copy(seed);
  return Keypair.fromSeed(seed);
}

const BLOCKHASH = PublicKey.default.toBase58();

function signedSolanaTx(
  payer: Keypair,
  ...ixs: TransactionInstruction[]
): string {
  const tx = new Transaction({
    feePayer: payer.publicKey,
    recentBlockhash: BLOCKHASH,
  }).add(...ixs);
  tx.sign(payer);
  return Buffer.from(tx.serialize()).toString('base64');
}

function solanaTransfer(): string {
  const payer = fixtureKey('transfer-payer');
  return signedSolanaTx(
    payer,
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: fixtureKey('transfer-recipient').publicKey,
      lamports: 5_000,
    })
  );
}

function solanaDrainer(): string {
  const payer = fixtureKey('drainer-payer');
  return signedSolanaTx(
    payer,
    new TransactionInstruction({
      programId: new PublicKey(SEED_DRAINER_PROGRAM_ID),
      keys: [{ pubkey: payer.publicKey, isSigner: true, isWritable: true }],
      data: Buffer.from([1, 2, 3]),
    })
  );
}

function solanaAta(useWrongAccount: boolean): string {
  const payer = fixtureKey('ata-payer');
  const wallet = fixtureKey('ata-wallet').publicKey;
  const mint = fixtureKey('ata-mint').publicKey;
  const account = useWrongAccount
    ? fixtureKey('ata-impostor').publicKey
    : getAssociatedTokenAddressSync(mint, wallet);
  return signedSolanaTx(
    payer,
    createAssociatedTokenAccountIdempotentInstruction(
      payer.publicKey,
      account,
      wallet,
      mint
    )
  );
}

function evm(
  id: string,
  description: string,
  input: string,
  expect: DatasetCase['expect'],
  extra: Pick<DatasetCase, 'from' | 'config'> = {}
): DatasetCase {
  return { id, chain: 'evm', description, input, ...extra, expect };
}

function solana(
  id: string,
  description: string,
  input: string,
  expect: DatasetCase['expect']
): DatasetCase {
  return { id, chain: 'solana', description, input, expect };
}

/**
 * Build the example dataset from code. `npm run dataset` writes this to
 * examples/dataset/cases.json, and a test fails if the two drift apart.
 * Expectations are written by hand, not copied from decoder output.
 */
export function buildExampleDataset(): Dataset {
  const cases: DatasetCase[] = [
    evm('erc20-unlimited-approve', 'approve() for max uint256 to a router contract.',
      approve(ROUTER, MAX_UINT),
      { type: 'erc20_approve', risks: ['unlimited_approval'], severity: 'high' }),
    evm('erc20-limited-approve', 'approve() for 100 units to a router contract.',
      approve(ROUTER, '64'),
      { type: 'erc20_approve', risks: [], severity: 'info' }),
    evm('erc20-revoke-approve', 'approve() for zero, which revokes the allowance.',
      approve(PHISHING_DRAINER, '0'),
      { type: 'erc20_approve', risks: [], severity: 'info' }),
    evm('erc20-phishing-approve', 'Finite approve() to a spender on the phishing seed list.',
      approve(PHISHING_DRAINER, '64'),
      { type: 'erc20_approve', risks: ['phishing_spender'], severity: 'high' }),
    evm('erc20-blocklisted-approve', 'Finite approve() to a spender on the example block list.',
      approve(BLOCKED, '64'),
      { type: 'erc20_approve', risks: ['blocklisted_spender'], severity: 'high' },
      { config: RISK_LISTS }),
    evm('erc20-unlimited-permit', 'EIP-2612 permit() for max uint256 to a router contract.',
      eip2612Permit(ROUTER, (1n << 256n) - 1n),
      { type: 'erc20_permit', risks: ['unlimited_permit'], severity: 'high' }),
    evm('erc20-phishing-permit', 'Finite EIP-2612 permit() to a spender on the phishing seed list.',
      eip2612Permit(PHISHING_DRAINER, 100n),
      { type: 'erc20_permit', risks: ['phishing_spender'], severity: 'high' }),
    evm('dai-permit-allowed', 'DAI-style permit(allowed=true) with no expiry to a router.',
      daiPermit(ROUTER, true),
      { type: 'erc20_permit', risks: ['unlimited_permit'], severity: 'high' }),
    evm('dai-permit-revoke', 'DAI-style permit(allowed=false), which revokes the allowance.',
      daiPermit(PHISHING_DRAINER, false),
      { type: 'erc20_permit', risks: [], severity: 'info' }),
    evm('erc20-plain-transfer', 'transfer() of 255 units from a named sender.',
      transfer(RECIPIENT, 'ff'),
      { type: 'erc20_transfer', risks: [], severity: 'info' },
      { from: SENDER }),
    evm('erc20-burn-transfer', 'transfer() to the zero address.',
      transfer('0'.repeat(40), '0a'),
      { type: 'erc20_transfer', risks: ['burn_to_zero_address'], severity: 'warn' }),
    evm('erc20-increase-allowance', 'increaseAllowance() by 42 units for a router.',
      increaseAllowance(ROUTER, '2a'),
      { type: 'erc20_increaseAllowance', risks: [], severity: 'info' }),
    evm('erc20-increase-allowance-phishing', 'increaseAllowance() for a phishing-listed spender.',
      increaseAllowance(PHISHING_DRAINER, '2a'),
      { type: 'erc20_increaseAllowance', risks: ['phishing_spender'], severity: 'high' }),
    evm('erc20-decrease-allowance', 'decreaseAllowance() by 7 units for a router.',
      decreaseAllowance(ROUTER, '07'),
      { type: 'erc20_decreaseAllowance', risks: [], severity: 'info' }),
    evm('nft-approve-all', 'setApprovalForAll(true) to a router operator.',
      setApprovalForAll(ROUTER, true),
      { type: 'nft_setApprovalForAll', risks: ['erc721_approve_all', 'erc1155_approve_all'], severity: 'high' }),
    evm('nft-revoke-all', 'setApprovalForAll(false), an operator revocation.',
      setApprovalForAll(ROUTER, false),
      { type: 'nft_setApprovalForAll', risks: [], severity: 'info' }),
    evm('abi-transfer-from', 'transferFrom() decoded through the common ABI set.',
      encodeFunctionData({
        abi: TRANSFER_FROM_ABI,
        functionName: 'transferFrom',
        args: [SENDER, `0x${RECIPIENT}`, 500n],
      }),
      { type: 'abi_call', risks: [], severity: 'info' }),
    evm('rawtx-eip1559-unlimited-approve', 'Unsigned EIP-1559 tx on chain 1 wrapping an unlimited approve.',
      eip1559Tx(approve(ROUTER, MAX_UINT), 1),
      { type: 'erc20_approve', risks: ['unlimited_approval'], severity: 'high' }),
    evm('rawtx-legacy-burn', 'Legacy EIP-155 tx on chain 137 wrapping a burn transfer.',
      legacyTx(transfer('0'.repeat(40), '01'), 137),
      { type: 'erc20_transfer', risks: ['burn_to_zero_address'], severity: 'warn' }),
    solana('solana-system-transfer', 'Signed legacy SOL transfer with no risks.',
      solanaTransfer(),
      { type: 'solana_tx', risks: [], severity: 'info' }),
    solana('solana-drainer-invoke', 'Direct invoke of a program on the suspicious seed list.',
      solanaDrainer(),
      { type: 'solana_tx', risks: ['solana_suspicious_cpi'], severity: 'high' }),
    solana('solana-ata-create', 'createIdempotent for the correctly derived associated token account.',
      solanaAta(false),
      { type: 'solana_tx', risks: [], severity: 'info' }),
    solana('solana-ata-mismatch', 'createIdempotent naming an account that is not the derived ATA.',
      solanaAta(true),
      { type: 'solana_tx', risks: ['solana_ata_mismatch'], severity: 'warn' }),
  ];
  return { version: DATASET_VERSION, cases };
}

/** Stable JSON text for the dataset file (2-space indent, trailing newline). */
export function serializeDataset(dataset: Dataset): string {
  return `${JSON.stringify(dataset, null, 2)}\n`;
}
