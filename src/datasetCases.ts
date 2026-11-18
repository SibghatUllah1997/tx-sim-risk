import { encodeFunctionData, parseAbi, serializeTransaction, type Hex } from 'viem';
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import {
  AuthorityType,
  createAssociatedTokenAccountIdempotentInstruction,
  createSetAuthorityInstruction,
  createTransferCheckedInstruction,
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

const TOKEN: Hex = `0x${'cc'.repeat(20)}`;
const MAX_UINT160 = (1n << 160n) - 1n;
const MAX_UINT48 = (1n << 48n) - 1n;
const PERMIT2_SIG: Hex = `0x${'ab'.repeat(65)}`;
const PERMIT2_EXPIRY = 1_900_000_000n;

const PERMIT2_APPROVE_ABI = parseAbi([
  'function approve(address token, address spender, uint160 amount, uint48 expiration)',
]);
const PERMIT2_PERMIT_ABI = parseAbi([
  'function permit(address owner, ((address token, uint160 amount, uint48 expiration, uint48 nonce) details, address spender, uint256 sigDeadline) permitSingle, bytes signature)',
]);
const PERMIT2_TRANSFER_ABI = parseAbi([
  'function permitTransferFrom(((address token, uint256 amount) permitted, uint256 nonce, uint256 deadline) permit, (address to, uint256 requestedAmount) transferDetails, address owner, bytes signature)',
]);

function permit2Approve(spender: string, amount: bigint, expiration: bigint): Hex {
  return encodeFunctionData({
    abi: PERMIT2_APPROVE_ABI,
    functionName: 'approve',
    args: [TOKEN, `0x${spender}`, amount, Number(expiration)],
  });
}

function permit2Permit(spender: string, amount: bigint, expiration: bigint): Hex {
  return encodeFunctionData({
    abi: PERMIT2_PERMIT_ABI,
    functionName: 'permit',
    args: [
      SENDER,
      {
        details: { token: TOKEN, amount, expiration: Number(expiration), nonce: 1 },
        spender: `0x${spender}`,
        sigDeadline: PERMIT2_EXPIRY,
      },
      PERMIT2_SIG,
    ],
  });
}

function permit2TransferFrom(to: string, amount: bigint): Hex {
  return encodeFunctionData({
    abi: PERMIT2_TRANSFER_ABI,
    functionName: 'permitTransferFrom',
    args: [
      { permitted: { token: TOKEN, amount }, nonce: 1n, deadline: PERMIT2_EXPIRY },
      { to: `0x${to}`, requestedAmount: amount },
      SENDER,
      PERMIT2_SIG,
    ],
  });
}

const BATCH_ABI = parseAbi([
  'function multicall(bytes[] data)',
  'function aggregate3((address target, bool allowFailure, bytes callData)[] calls)',
]);

function routerMulticall(calls: Hex[]): Hex {
  return encodeFunctionData({ abi: BATCH_ABI, functionName: 'multicall', args: [calls] });
}

function multicall3(calls: Hex[]): Hex {
  return encodeFunctionData({
    abi: BATCH_ABI,
    functionName: 'aggregate3',
    args: [calls.map((callData) => ({ target: TOKEN, allowFailure: false, callData }))],
  });
}

const TRANSFER_FROM_ABI = parseAbi([
  'function transferFrom(address from, address to, uint256 value)',
]);
const EXECUTE_ABI = parseAbi([
  'function execute(address dest, uint256 value, bytes func)',
]);
const HANDLE_OPS_V06_ABI = parseAbi([
  'function handleOps((address sender, uint256 nonce, bytes initCode, bytes callData, uint256 callGasLimit, uint256 verificationGasLimit, uint256 preVerificationGas, uint256 maxFeePerGas, uint256 maxPriorityFeePerGas, bytes paymasterAndData, bytes signature)[] ops, address beneficiary)',
]);

const BENEFICIARY: Hex = `0x${'22'.repeat(20)}`;
const PAYMASTER: Hex = `0x${'33'.repeat(20)}`;
const DELEGATE: Hex = `0x${'aa'.repeat(20)}`;
const USEROP_SIGNATURE: Hex = `0x${'ab'.repeat(65)}`;
const AUTH_R: Hex = `0x${'11'.repeat(32)}`;
const AUTH_S: Hex = `0x${'22'.repeat(32)}`;

function execute(dest: Hex, func: Hex): Hex {
  return encodeFunctionData({
    abi: EXECUTE_ABI,
    functionName: 'execute',
    args: [dest, 0n, func],
  });
}

function handleOpsV06(callData: Hex, paymasterAndData: Hex = '0x'): Hex {
  return encodeFunctionData({
    abi: HANDLE_OPS_V06_ABI,
    functionName: 'handleOps',
    args: [
      [
        {
          sender: SENDER,
          nonce: 1n,
          initCode: '0x',
          callData,
          callGasLimit: 80_000n,
          verificationGasLimit: 90_000n,
          preVerificationGas: 21_000n,
          maxFeePerGas: 30n,
          maxPriorityFeePerGas: 2n,
          paymasterAndData,
          signature: USEROP_SIGNATURE,
        },
      ],
      BENEFICIARY,
    ],
  });
}

function eip7702Tx(chainId: number, delegate: Hex): Hex {
  return serializeTransaction({
    type: 'eip7702',
    chainId: 1,
    nonce: 4,
    maxPriorityFeePerGas: 1n,
    maxFeePerGas: 2n,
    gas: 50_000n,
    to: TX_TARGET,
    value: 0n,
    data: '0x',
    authorizationList: [
      {
        chainId,
        address: delegate,
        nonce: 0,
        r: AUTH_R,
        s: AUTH_S,
        yParity: 1,
      },
    ],
  });
}

function eip1559Tx(data: Hex, chainId: number, value = 0n, to: Hex = TX_TARGET): Hex {
  return serializeTransaction({
    type: 'eip1559',
    chainId,
    nonce: 7,
    gas: 60_000n,
    maxPriorityFeePerGas: 2_000_000_000n,
    maxFeePerGas: 30_000_000_000n,
    to,
    value,
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

function solanaSplTransferChecked(): string {
  const payer = fixtureKey('spl-transfer-payer');
  return signedSolanaTx(
    payer,
    createTransferCheckedInstruction(
      fixtureKey('spl-transfer-source').publicKey,
      fixtureKey('spl-transfer-mint').publicKey,
      fixtureKey('spl-transfer-dest').publicKey,
      payer.publicKey,
      1_500_000n,
      6
    )
  );
}

function solanaSplSetAuthority(): string {
  const payer = fixtureKey('spl-authority-payer');
  return signedSolanaTx(
    payer,
    createSetAuthorityInstruction(
      fixtureKey('spl-authority-account').publicKey,
      payer.publicKey,
      AuthorityType.AccountOwner,
      fixtureKey('spl-authority-next').publicKey
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
    evm('permit2-unlimited-approve', 'Permit2 approve() for type(uint160).max that never expires.',
      permit2Approve(ROUTER, MAX_UINT160, MAX_UINT48),
      { type: 'permit2', risks: ['unlimited_approval', 'permit2_no_expiry'], severity: 'high' }),
    evm('permit2-phishing-permit', 'Finite Permit2 permit() to a spender on the phishing seed list.',
      permit2Permit(PHISHING_DRAINER, 100n, PERMIT2_EXPIRY),
      { type: 'permit2', risks: ['phishing_spender'], severity: 'high' }),
    evm('permit2-transfer-from', 'Permit2 permitTransferFrom() of 80 units to a named recipient.',
      permit2TransferFrom(RECIPIENT, 80n),
      { type: 'permit2', risks: [], severity: 'info' }),
    evm('permit2-phishing-transfer', 'Permit2 permitTransferFrom() to a phishing-listed recipient.',
      permit2TransferFrom(PHISHING_DRAINER, 80n),
      { type: 'permit2', risks: ['phishing_spender'], severity: 'high' }),
    evm('multicall-hidden-unlimited-approve', 'Router multicall() that bundles a transfer with an unlimited approve.',
      routerMulticall([transfer(RECIPIENT, 'ff'), approve(ROUTER, MAX_UINT)]),
      { type: 'multicall', risks: ['unlimited_approval', 'multicall_batched_grant'], severity: 'high' },
      { from: SENDER }),
    evm('multicall3-plain-transfers', 'Multicall3 aggregate3() with two plain transfers and no grants.',
      multicall3([transfer(RECIPIENT, '1'), transfer(RECIPIENT, '2')]),
      { type: 'multicall', risks: [], severity: 'info' }),
    evm('erc4337-calldata-approve', 'EntryPoint handleOps whose execute() callData is an unlimited approve.',
      handleOpsV06(execute(TOKEN, approve(ROUTER, MAX_UINT))),
      { type: 'erc4337_userop', risks: ['erc4337_calldata_approval', 'unlimited_approval'], severity: 'high' }),
    evm('erc4337-paymaster', 'EntryPoint handleOps with a paymaster and a plain token transfer.',
      handleOpsV06(execute(TOKEN, transfer(RECIPIENT, '50')), PAYMASTER),
      { type: 'erc4337_userop', risks: ['erc4337_paymaster'], severity: 'warn' }),
    evm('eip7702-delegation', 'Type-4 transaction designating a contract on chain 1.',
      eip7702Tx(1, DELEGATE),
      { type: 'eip7702', risks: ['eip7702_delegation'], severity: 'high' }),
    evm('eip7702-broad-delegate', 'Type-4 transaction with chain_id 0, valid on every chain.',
      eip7702Tx(0, DELEGATE),
      { type: 'eip7702', risks: ['eip7702_delegation', 'eip7702_broad_delegate'], severity: 'high' }),
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
    evm('rawtx-native-transfer', 'EIP-1559 tx sending 0.5 ETH with empty calldata.',
      eip1559Tx('0x', 1, 500_000_000_000_000_000n, `0x${RECIPIENT}`),
      { type: 'native_transfer', risks: [], severity: 'info' }),
    evm('rawtx-value-on-approve', 'EIP-1559 tx attaching 1 ETH to a non-payable approve.',
      eip1559Tx(approve(ROUTER, '64'), 1, 1_000_000_000_000_000_000n),
      { type: 'erc20_approve', risks: ['native_value_nonpayable_call'], severity: 'warn' }),
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
    solana('solana-spl-transfer-checked', 'SPL Token TransferChecked of 1.5 tokens with 6 decimals.',
      solanaSplTransferChecked(),
      { type: 'solana_tx', risks: [], severity: 'info' }),
    solana('solana-spl-set-authority', 'SPL Token SetAuthority reassigning account owner.',
      solanaSplSetAuthority(),
      { type: 'solana_tx', risks: ['solana_authority_change'], severity: 'high' }),
  ];
  return { version: DATASET_VERSION, cases };
}

/** Stable JSON text for the dataset file (2-space indent, trailing newline). */
export function serializeDataset(dataset: Dataset): string {
  return `${JSON.stringify(dataset, null, 2)}\n`;
}
