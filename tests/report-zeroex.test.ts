import { describe, expect, it } from 'vitest';
import { encodeFunctionData, parseAbi, type Hex } from 'viem';
import {
  UNLIMITED_APPROVAL_RISK,
  ZEROEX_SIGNATURES,
  formatDetectedHeader,
  generateJsonReport,
  isValidReport,
} from '../src';

const TOKEN: Hex = '0xcccccccccccccccccccccccccccccccccccccccc';
const TOKEN_OUT: Hex = '0xdddddddddddddddddddddddddddddddddddddddd';
const MAKER: Hex = '0x1111111111111111111111111111111111111111';
const TAKER: Hex = '0x2222222222222222222222222222222222222222';
const SENDER: Hex = '0x3333333333333333333333333333333333333333';
const FEE_RECIPIENT: Hex = '0x4444444444444444444444444444444444444444';
const SIGNER: Hex = '0x5555555555555555555555555555555555555555';
const ZERO: Hex = '0x0000000000000000000000000000000000000000';
const ROUTER: Hex = '0x7a250d5630b4cf539739df2c5dacb4c659f2488d';
const POOL: Hex = `0x${'ab'.repeat(32)}`;
const SIG_R: Hex = `0x${'11'.repeat(32)}`;
const SIG_S: Hex = `0x${'22'.repeat(32)}`;
const MAX_UINT256 = (1n << 256n) - 1n;

const ERC20_ABI = parseAbi([
  'function approve(address spender, uint256 value)',
  'function transfer(address to, uint256 value)',
]);
const ZEROEX_ABI = parseAbi([
  'function transformERC20(address inputToken, address outputToken, uint256 inputTokenAmount, uint256 minOutputTokenAmount, (uint32 deploymentNonce, bytes data)[] transformations)',
  'function executeMetaTransaction((address signer, address sender, uint256 minGasPrice, uint256 maxGasPrice, uint256 expirationTimeSeconds, uint256 salt, bytes callData, uint256 value, address feeToken, uint256 feeAmount) mtx, (uint8 signatureType, uint8 v, bytes32 r, bytes32 s) signature)',
  'function fillLimitOrder((address makerToken, address takerToken, uint128 makerAmount, uint128 takerAmount, uint128 takerTokenFeeAmount, address maker, address taker, address sender, address feeRecipient, bytes32 pool, uint64 expiry, uint256 salt) order, (uint8 signatureType, uint8 v, bytes32 r, bytes32 s) signature, uint128 takerTokenFillAmount)',
]);

const eip712Sig = {
  signatureType: 2,
  v: 27,
  r: SIG_R,
  s: SIG_S,
} as const;

function approve(spender: Hex, value: bigint): Hex {
  return encodeFunctionData({
    abi: ERC20_ABI,
    functionName: 'approve',
    args: [spender, value],
  });
}

function transfer(to: Hex, value: bigint): Hex {
  return encodeFunctionData({
    abi: ERC20_ABI,
    functionName: 'transfer',
    args: [to, value],
  });
}

function transform(data: Hex = '0x'): Hex {
  return encodeFunctionData({
    abi: ZEROEX_ABI,
    functionName: 'transformERC20',
    args: [
      TOKEN,
      TOKEN_OUT,
      10n,
      9n,
      [{ deploymentNonce: 3, data }],
    ],
  });
}

function metaTx(callData: Hex): Hex {
  return encodeFunctionData({
    abi: ZEROEX_ABI,
    functionName: 'executeMetaTransaction',
    args: [
      {
        signer: SIGNER,
        sender: ZERO,
        minGasPrice: 1n,
        maxGasPrice: 100n,
        expirationTimeSeconds: 1_900_000_000n,
        salt: 9n,
        callData,
        value: 0n,
        feeToken: TOKEN,
        feeAmount: 1n,
      },
      eip712Sig,
    ],
  });
}

describe('zeroex reports', () => {
  it('nests an inner approve on a transformer and rolls its unlimited-approval risk up', () => {
    const report = generateJsonReport(
      transform(approve(ROUTER, MAX_UINT256))
    )!;
    expect(report.type).toBe('zeroex');
    if (report.type !== 'zeroex') return;
    expect(report.payload.variant).toBe('transform_erc20');
    expect(report.payload.inputToken).toBe(TOKEN);
    expect(report.payload.outputToken).toBe(TOKEN_OUT);
    expect(report.payload.transformations).toHaveLength(1);
    expect(report.payload.transformations[0]?.innerReport?.type).toBe(
      'erc20_approve'
    );
    expect(report.payload.transformations[0]?.innerReport?.risks).toEqual([
      UNLIMITED_APPROVAL_RISK,
    ]);
    expect(report.payload.callReport).toBeNull();
    expect(report.risks).toEqual([UNLIMITED_APPROVAL_RISK]);
    expect(report.severity).toBe('high');
    expect(report.payload.transformations[0]?.depthLimited).toBe(false);
    expect(isValidReport(report)).toBe(true);
  });

  it('nests meta-transaction calldata and rolls inner risks up', () => {
    const report = generateJsonReport(
      metaTx(approve(ROUTER, MAX_UINT256))
    )!;
    expect(report.type).toBe('zeroex');
    if (report.type !== 'zeroex') return;
    expect(report.payload.variant).toBe('execute_meta_transaction');
    expect(report.payload.signer).toBe(SIGNER);
    expect(report.payload.callReport?.type).toBe('erc20_approve');
    expect(report.payload.callReport?.risks).toEqual([UNLIMITED_APPROVAL_RISK]);
    expect(report.risks).toEqual([UNLIMITED_APPROVAL_RISK]);
    expect(report.severity).toBe('high');
    expect(isValidReport(report)).toBe(true);
  });

  it('keeps a plain inner transfer as info and records the transform simulation note', () => {
    const report = generateJsonReport(transform(transfer(TAKER, 9n)))!;
    expect(report.type).toBe('zeroex');
    if (report.type !== 'zeroex') return;
    expect(report.payload.transformations[0]?.innerReport?.type).toBe(
      'erc20_transfer'
    );
    expect(report.risks).toEqual([]);
    expect(report.severity).toBe('info');
    expect(
      report.simulation.notes.some((n) => /transformERC20/.test(n))
    ).toBe(true);
    expect(isValidReport(report)).toBe(true);
  });

  it('lists transformERC20 fields in the text header', () => {
    const report = generateJsonReport(transform())!;
    expect(report.type).toBe('zeroex');
    expect(formatDetectedHeader(report)).toEqual([
      `Detected: 0x Exchange Proxy ${ZEROEX_SIGNATURES.transform_erc20}`,
      `Input token: ${TOKEN}`,
      `Output token: ${TOKEN_OUT}`,
      'Amount: 10',
      'Min return: 9',
      'Transformations: 1',
    ]);
    expect(isValidReport(report)).toBe(true);
  });

  it('decodes fillLimitOrder without nested calldata', () => {
    const report = generateJsonReport(
      encodeFunctionData({
        abi: ZEROEX_ABI,
        functionName: 'fillLimitOrder',
        args: [
          {
            makerToken: TOKEN_OUT,
            takerToken: TOKEN,
            makerAmount: 9n,
            takerAmount: 10n,
            takerTokenFeeAmount: 1n,
            maker: MAKER,
            taker: TAKER,
            sender: SENDER,
            feeRecipient: FEE_RECIPIENT,
            pool: POOL,
            expiry: 1_900_000_000n,
            salt: 8n,
          },
          eip712Sig,
          10n,
        ],
      })
    )!;
    expect(report.type).toBe('zeroex');
    if (report.type !== 'zeroex') return;
    expect(report.payload.variant).toBe('fill_limit_order');
    expect(report.payload.maker).toBe(MAKER);
    expect(report.payload.taker).toBe(TAKER);
    expect(report.payload.feeRecipient).toBe(FEE_RECIPIENT);
    expect(report.payload.takerTokenFillAmount).toBe('10');
    expect(report.payload.callReport).toBeNull();
    expect(report.risks).toEqual([]);
    expect(
      report.simulation.notes.some((n) => /fillLimitOrder/.test(n))
    ).toBe(true);
    expect(formatDetectedHeader(report)).toEqual([
      `Detected: 0x Exchange Proxy ${ZEROEX_SIGNATURES.fill_limit_order}`,
      `Input token: ${TOKEN}`,
      `Output token: ${TOKEN_OUT}`,
      `Maker: ${MAKER}`,
      `Taker: ${TAKER}`,
      `Fee recipient: ${FEE_RECIPIENT}`,
      'Fill amount: 10',
    ]);
    expect(isValidReport(report)).toBe(true);
  });
});
