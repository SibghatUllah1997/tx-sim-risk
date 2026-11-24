import {
  encodeAbiParameters,
  encodeFunctionData,
  parseAbi,
  parseAbiParameters,
  serializeTransaction,
  type Hex,
} from 'viem';
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import { SEED_DRAINER_PROGRAM_ID } from '../../src/solana/programs';

function word(hexNoPrefix: string): string {
  return hexNoPrefix.padStart(64, '0');
}

function addressWord(addressNo0x: string): string {
  return word(addressNo0x.toLowerCase());
}

export const MAX_UINT = 'f'.repeat(64);
export const ROUTER = '7a250d5630b4cf539739df2c5dacb4c659f2488d';
export const BLOCKED = 'badc0ffee0000000000000000000000000000001';
export const RECIPIENT = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
export const SENDER = '0x1111111111111111111111111111111111111111';

export function approveCalldata(spenderNo0x: string, amountHex: string): Hex {
  return `0x095ea7b3${addressWord(spenderNo0x)}${word(amountHex)}`;
}

export function transferCalldata(toNo0x: string, amountHex: string): Hex {
  return `0xa9059cbb${addressWord(toNo0x)}${word(amountHex)}`;
}

export function setApprovalForAllCalldata(
  operatorNo0x: string,
  approved: boolean
): Hex {
  return `0xa22cb465${addressWord(operatorNo0x)}${word(approved ? '1' : '0')}`;
}

const SAFE_ABI = parseAbi([
  'function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures)',
]);

const ZERO: Hex = `0x${'0'.repeat(40)}`;
const TOKEN: Hex = `0x${'cc'.repeat(20)}`;
const SAFE_SIG: Hex = `0x${'ab'.repeat(65)}`;

const UR_ABI = parseAbi([
  'function execute(bytes commands, bytes[] inputs)',
]);
const UR_TOKEN: Hex = `0x${'cc'.repeat(20)}`;
const UR_SIG: Hex = `0x${'ab'.repeat(65)}`;

/** Uniswap Universal Router execute wrapping a single Permit2 permit command. */
export function universalRouterPermitCalldata(
  spenderNo0x: string,
  amount: bigint
): Hex {
  const permit = encodeAbiParameters(
    parseAbiParameters(
      '((address token, uint160 amount, uint48 expiration, uint48 nonce) details, address spender, uint256 sigDeadline) permitSingle, bytes signature'
    ),
    [
      {
        details: {
          token: UR_TOKEN,
          amount,
          expiration: 1_900_000_000,
          nonce: 1,
        },
        spender: `0x${spenderNo0x}`,
        sigDeadline: 1_900_000_000n,
      },
      UR_SIG,
    ]
  );
  return encodeFunctionData({
    abi: UR_ABI,
    functionName: 'execute',
    args: ['0x0a', [permit]],
  });
}

/** Uniswap Universal Router execute wrapping an unwrap-WETH command. */
export function universalRouterUnwrapCalldata(recipientNo0x: string): Hex {
  const input = encodeAbiParameters(
    parseAbiParameters('address recipient, uint256 amountMin'),
    [`0x${recipientNo0x}`, 1n]
  );
  return encodeFunctionData({
    abi: UR_ABI,
    functionName: 'execute',
    args: ['0x0c', [input]],
  });
}

const COW_ABI = parseAbi([
  'function settle(address[] tokens, uint256[] clearingPrices, (uint256 sellTokenIndex, uint256 buyTokenIndex, address receiver, uint256 sellAmount, uint256 buyAmount, uint32 validTo, bytes32 appData, uint256 feeAmount, uint256 flags, uint256 executedAmount, bytes signature)[] trades, (address target, uint256 value, bytes callData)[][3] interactions)',
]);
const COW_TOKEN: Hex = `0x${'cc'.repeat(20)}`;
const COW_TOKEN_OUT: Hex = `0x${'dd'.repeat(20)}`;
const COW_RECEIVER: Hex = `0x${'aa'.repeat(20)}`;
const COW_APP: Hex = `0x${'11'.repeat(32)}`;

const ONEINCH_ABI = parseAbi([
  'function swap(address executor, (address srcToken, address dstToken, address srcReceiver, address dstReceiver, uint256 amount, uint256 minReturnAmount, uint256 flags) desc, bytes permit, bytes data)',
]);
const ONEINCH_EXECUTOR: Hex = `0x${'11'.repeat(20)}`;
const ONEINCH_SRC_RECEIVER: Hex = `0x${'22'.repeat(20)}`;
const ONEINCH_DST_RECEIVER: Hex = `0x${'aa'.repeat(20)}`;
const ONEINCH_TOKEN: Hex = `0x${'cc'.repeat(20)}`;
const ONEINCH_TOKEN_OUT: Hex = `0x${'dd'.repeat(20)}`;

/** 1inch Aggregation Router swap wrapping executor calldata. */
export function oneInchSwapCalldata(callData: Hex, permit: Hex = '0x'): Hex {
  return encodeFunctionData({
    abi: ONEINCH_ABI,
    functionName: 'swap',
    args: [
      ONEINCH_EXECUTOR,
      {
        srcToken: ONEINCH_TOKEN,
        dstToken: ONEINCH_TOKEN_OUT,
        srcReceiver: ONEINCH_SRC_RECEIVER,
        dstReceiver: ONEINCH_DST_RECEIVER,
        amount: 10n,
        minReturnAmount: 9n,
        flags: 0n,
      },
      permit,
      callData,
    ],
  });
}

/** CowSwap GPv2Settlement settle wrapping one pre-interaction. */
export function cowswapSettleCalldata(callData: Hex, target: Hex = COW_TOKEN): Hex {
  return encodeFunctionData({
    abi: COW_ABI,
    functionName: 'settle',
    args: [
      [COW_TOKEN, COW_TOKEN_OUT],
      [1n, 2n],
      [
        {
          sellTokenIndex: 0n,
          buyTokenIndex: 1n,
          receiver: COW_RECEIVER,
          sellAmount: 10n,
          buyAmount: 9n,
          validTo: 1_900_000_000,
          appData: COW_APP,
          feeAmount: 1n,
          flags: 0n,
          executedAmount: 0n,
          signature: '0xabcd',
        },
      ],
      [[{ target, value: 0n, callData }], [], []],
    ],
  });
}

/** Gnosis Safe execTransaction wrapping `data` as a Call. */
export function safeExecCalldata(data: Hex, operation = 0): Hex {
  return encodeFunctionData({
    abi: SAFE_ABI,
    functionName: 'execTransaction',
    args: [TOKEN, 0n, data, operation, 0n, 0n, 0n, ZERO, ZERO, SAFE_SIG],
  });
}

/** Unsigned EIP-1559 transaction carrying `data`, serialized by viem. */
export function eip1559RawTx(data: Hex, chainId = 1): Hex {
  return serializeTransaction({
    type: 'eip1559',
    chainId,
    nonce: 7,
    gas: 60_000n,
    maxPriorityFeePerGas: 2_000_000_000n,
    maxFeePerGas: 30_000_000_000n,
    to: `0x${'cc'.repeat(20)}`,
    value: 0n,
    data,
  });
}

/** Legacy EIP-155 transaction (v = chainId * 2 + 35) carrying `data`. */
export function legacyRawTx(data: Hex, chainId: number): Hex {
  return serializeTransaction(
    {
      type: 'legacy',
      chainId,
      nonce: 1,
      gas: 60_000n,
      gasPrice: 10_000_000_000n,
      to: `0x${'cc'.repeat(20)}`,
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

const BLOCKHASH = PublicKey.default.toBase58();

/** Signed legacy Solana transfer, base64-encoded as wallets export it. */
export function solanaTransferBase64(): { base64: string; payer: string } {
  const payer = Keypair.generate();
  const tx = new Transaction({
    feePayer: payer.publicKey,
    recentBlockhash: BLOCKHASH,
  }).add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: Keypair.generate().publicKey,
      lamports: 5_000,
    })
  );
  tx.sign(payer);
  return {
    base64: Buffer.from(tx.serialize()).toString('base64'),
    payer: payer.publicKey.toBase58(),
  };
}

/** Signed Solana transaction that directly invokes a seed-listed drainer. */
export function solanaDrainerBase64(): string {
  const payer = Keypair.generate();
  const tx = new Transaction({
    feePayer: payer.publicKey,
    recentBlockhash: BLOCKHASH,
  }).add(
    new TransactionInstruction({
      programId: new PublicKey(SEED_DRAINER_PROGRAM_ID),
      keys: [{ pubkey: payer.publicKey, isSigner: true, isWritable: true }],
      data: Buffer.from([1, 2, 3]),
    })
  );
  tx.sign(payer);
  return Buffer.from(tx.serialize()).toString('base64');
}
