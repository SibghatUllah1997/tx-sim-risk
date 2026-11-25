import { describe, expect, it } from 'vitest';
import { encodeFunctionData, parseAbi, type Hex } from 'viem';
import {
  MAX_ZEROEX_FEES,
  MAX_ZEROEX_TRANSFORMATIONS,
  ZEROEX_NATIVE_TOKEN,
  ZEROEX_SIGNATURES,
  decodeZeroEx,
  extractZeroExOtcExpiry,
  isZeroExNativeToken,
  zeroExSignatureKind,
} from '../src/evm/zeroEx';

const TOKEN: Hex = '0xcccccccccccccccccccccccccccccccccccccccc';
const TOKEN_OUT: Hex = '0xdddddddddddddddddddddddddddddddddddddddd';
const MAKER: Hex = '0x1111111111111111111111111111111111111111';
const TAKER: Hex = '0x2222222222222222222222222222222222222222';
const SENDER: Hex = '0x3333333333333333333333333333333333333333';
const FEE_RECIPIENT: Hex = '0x4444444444444444444444444444444444444444';
const SIGNER: Hex = '0x5555555555555555555555555555555555555555';
const TX_ORIGIN: Hex = '0x6666666666666666666666666666666666666666';
const ZERO: Hex = '0x0000000000000000000000000000000000000000';
const POOL: Hex = `0x${'ab'.repeat(32)}`;
const SIG_R: Hex = `0x${'11'.repeat(32)}`;
const SIG_S: Hex = `0x${'22'.repeat(32)}`;

const ERC20_ABI = parseAbi([
  'function approve(address spender, uint256 value)',
]);
const ZEROEX_ABI = parseAbi([
  'function transformERC20(address inputToken, address outputToken, uint256 inputTokenAmount, uint256 minOutputTokenAmount, (uint32 deploymentNonce, bytes data)[] transformations)',
  'function executeMetaTransaction((address signer, address sender, uint256 minGasPrice, uint256 maxGasPrice, uint256 expirationTimeSeconds, uint256 salt, bytes callData, uint256 value, address feeToken, uint256 feeAmount) mtx, (uint8 signatureType, uint8 v, bytes32 r, bytes32 s) signature)',
  'function executeMetaTransactionV2((address signer, address sender, uint256 expirationTimeSeconds, uint256 salt, bytes callData, address feeToken, (address recipient, uint256 amount)[] fees) mtx, (uint8 signatureType, uint8 v, bytes32 r, bytes32 s) signature)',
  'function fillLimitOrder((address makerToken, address takerToken, uint128 makerAmount, uint128 takerAmount, uint128 takerTokenFeeAmount, address maker, address taker, address sender, address feeRecipient, bytes32 pool, uint64 expiry, uint256 salt) order, (uint8 signatureType, uint8 v, bytes32 r, bytes32 s) signature, uint128 takerTokenFillAmount)',
  'function fillRfqOrder((address makerToken, address takerToken, uint128 makerAmount, uint128 takerAmount, address maker, address taker, address txOrigin, bytes32 pool, uint64 expiry, uint256 salt) order, (uint8 signatureType, uint8 v, bytes32 r, bytes32 s) signature, uint128 takerTokenFillAmount)',
  'function fillOtcOrder((address makerToken, address takerToken, uint128 makerAmount, uint128 takerAmount, address maker, address taker, address txOrigin, uint256 expiryAndNonce) order, (uint8 signatureType, uint8 v, bytes32 r, bytes32 s) signature, uint128 takerTokenFillAmount)',
]);

const approve = encodeFunctionData({
  abi: ERC20_ABI,
  functionName: 'approve',
  args: [TAKER, 5n],
});

const eip712Sig = {
  signatureType: 2,
  v: 27,
  r: SIG_R,
  s: SIG_S,
} as const;

function transform(opts: {
  inputToken?: Hex;
  outputToken?: Hex;
  amount?: bigint;
  minOut?: bigint;
  transformations?: { deploymentNonce: number; data: Hex }[];
} = {}): Hex {
  return encodeFunctionData({
    abi: ZEROEX_ABI,
    functionName: 'transformERC20',
    args: [
      opts.inputToken ?? TOKEN,
      opts.outputToken ?? TOKEN_OUT,
      opts.amount ?? 10n,
      opts.minOut ?? 9n,
      opts.transformations ?? [{ deploymentNonce: 7, data: '0x' }],
    ],
  });
}

describe('decodeZeroEx', () => {
  it('returns null for unrelated selectors and short input', () => {
    expect(decodeZeroEx(approve)).toBeNull();
    expect(decodeZeroEx('0x')).toBeNull();
    expect(decodeZeroEx('0xdeadbeef')).toBeNull();
  });

  it('rejects non-hex input', () => {
    expect(() => decodeZeroEx('zz')).toThrow(/Invalid hex data/);
  });

  it('decodes transformERC20 with nested transformer data', () => {
    const decoded = decodeZeroEx(
      transform({ transformations: [{ deploymentNonce: 3, data: approve }] })
    )!;
    expect(decoded.method).toBe('zeroex');
    expect(decoded.variant).toBe('transform_erc20');
    expect(decoded.signature).toBe(ZEROEX_SIGNATURES.transform_erc20);
    expect(decoded.inputToken).toBe(TOKEN);
    expect(decoded.outputToken).toBe(TOKEN_OUT);
    expect(decoded.inputTokenAmount).toBe(10n);
    expect(decoded.minOutputTokenAmount).toBe(9n);
    expect(decoded.inputIsEth).toBe(false);
    expect(decoded.outputIsEth).toBe(false);
    expect(decoded.transformations).toEqual([
      { index: 0, deploymentNonce: 3, data: approve },
    ]);
    expect(decoded.callData).toBe('0x');
    expect(decoded.maker).toBeNull();
  });

  it('marks the native-ETH sentinel on transformERC20', () => {
    const decoded = decodeZeroEx(
      transform({ inputToken: ZEROEX_NATIVE_TOKEN, outputToken: TOKEN })
    )!;
    expect(decoded.inputIsEth).toBe(true);
    expect(decoded.outputIsEth).toBe(false);
    expect(isZeroExNativeToken(ZEROEX_NATIVE_TOKEN)).toBe(true);
    expect(isZeroExNativeToken(TOKEN)).toBe(false);
  });

  it('decodes executeMetaTransaction and keeps inner calldata', () => {
    const decoded = decodeZeroEx(
      encodeFunctionData({
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
            callData: approve,
            value: 0n,
            feeToken: TOKEN,
            feeAmount: 1n,
          },
          eip712Sig,
        ],
      })
    )!;
    expect(decoded.variant).toBe('execute_meta_transaction');
    expect(decoded.signature).toBe(ZEROEX_SIGNATURES.execute_meta_transaction);
    expect(decoded.signer).toBe(SIGNER);
    expect(decoded.sender).toBe(ZERO);
    expect(decoded.minGasPrice).toBe(1n);
    expect(decoded.maxGasPrice).toBe(100n);
    expect(decoded.expirationTimeSeconds).toBe(1_900_000_000);
    expect(decoded.salt).toBe(9n);
    expect(decoded.callData).toBe(approve);
    expect(decoded.value).toBe(0n);
    expect(decoded.feeToken).toBe(TOKEN);
    expect(decoded.feeAmount).toBe(1n);
    expect(decoded.signatureType).toBe(2);
    expect(decoded.signatureKind).toBe('eip712');
    expect(decoded.signatureV).toBe(27);
    expect(decoded.signatureR).toBe(SIG_R);
    expect(decoded.signatureS).toBe(SIG_S);
    expect(zeroExSignatureKind(3)).toBe('ethsign');
    expect(zeroExSignatureKind(99)).toBe('unknown');
  });

  it('decodes executeMetaTransactionV2 fees', () => {
    const decoded = decodeZeroEx(
      encodeFunctionData({
        abi: ZEROEX_ABI,
        functionName: 'executeMetaTransactionV2',
        args: [
          {
            signer: SIGNER,
            sender: SENDER,
            expirationTimeSeconds: 1_800_000_000n,
            salt: 2n,
            callData: '0x',
            feeToken: TOKEN,
            fees: [{ recipient: FEE_RECIPIENT, amount: 4n }],
          },
          eip712Sig,
        ],
      })
    )!;
    expect(decoded.variant).toBe('execute_meta_transaction_v2');
    expect(decoded.signature).toBe(
      ZEROEX_SIGNATURES.execute_meta_transaction_v2
    );
    expect(decoded.signer).toBe(SIGNER);
    expect(decoded.sender).toBe(SENDER);
    expect(decoded.callData).toBe('0x');
    expect(decoded.fees).toEqual([
      { index: 0, recipient: FEE_RECIPIENT, amount: 4n },
    ]);
    expect(decoded.minGasPrice).toBeNull();
  });

  it('decodes fillLimitOrder including an exclusive taker and fee recipient', () => {
    const decoded = decodeZeroEx(
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
    expect(decoded.variant).toBe('fill_limit_order');
    expect(decoded.signature).toBe(ZEROEX_SIGNATURES.fill_limit_order);
    expect(decoded.makerToken).toBe(TOKEN_OUT);
    expect(decoded.takerToken).toBe(TOKEN);
    expect(decoded.inputToken).toBe(TOKEN);
    expect(decoded.outputToken).toBe(TOKEN_OUT);
    expect(decoded.makerAmount).toBe(9n);
    expect(decoded.takerAmount).toBe(10n);
    expect(decoded.takerTokenFeeAmount).toBe(1n);
    expect(decoded.maker).toBe(MAKER);
    expect(decoded.taker).toBe(TAKER);
    expect(decoded.sender).toBe(SENDER);
    expect(decoded.feeRecipient).toBe(FEE_RECIPIENT);
    expect(decoded.pool).toBe(POOL);
    expect(decoded.expiry).toBe(1_900_000_000);
    expect(decoded.salt).toBe(8n);
    expect(decoded.takerTokenFillAmount).toBe(10n);
    expect(decoded.signatureKind).toBe('eip712');
  });

  it('decodes fillRfqOrder and fillOtcOrder, unpacking OTC expiry', () => {
    const rfq = decodeZeroEx(
      encodeFunctionData({
        abi: ZEROEX_ABI,
        functionName: 'fillRfqOrder',
        args: [
          {
            makerToken: TOKEN_OUT,
            takerToken: TOKEN,
            makerAmount: 5n,
            takerAmount: 6n,
            maker: MAKER,
            taker: ZERO,
            txOrigin: TX_ORIGIN,
            pool: POOL,
            expiry: 1_700_000_000n,
            salt: 3n,
          },
          eip712Sig,
          6n,
        ],
      })
    )!;
    expect(rfq.variant).toBe('fill_rfq_order');
    expect(rfq.signature).toBe(ZEROEX_SIGNATURES.fill_rfq_order);
    expect(rfq.txOrigin).toBe(TX_ORIGIN);
    expect(rfq.taker).toBe(ZERO);
    expect(rfq.feeRecipient).toBeNull();
    expect(rfq.expiry).toBe(1_700_000_000);

    const expiry = 1_650_000_000n;
    const expiryAndNonce = (expiry << 192n) | (7n << 128n) | 99n;
    const otc = decodeZeroEx(
      encodeFunctionData({
        abi: ZEROEX_ABI,
        functionName: 'fillOtcOrder',
        args: [
          {
            makerToken: TOKEN_OUT,
            takerToken: ZEROEX_NATIVE_TOKEN,
            makerAmount: 4n,
            takerAmount: 5n,
            maker: MAKER,
            taker: TAKER,
            txOrigin: TX_ORIGIN,
            expiryAndNonce,
          },
          eip712Sig,
          5n,
        ],
      })
    )!;
    expect(otc.variant).toBe('fill_otc_order');
    expect(otc.signature).toBe(ZEROEX_SIGNATURES.fill_otc_order);
    expect(otc.inputIsEth).toBe(true);
    expect(otc.expiryAndNonce).toBe(expiryAndNonce);
    expect(otc.expiry).toBe(1_650_000_000);
    expect(extractZeroExOtcExpiry(expiryAndNonce)).toBe(1_650_000_000);
    expect(otc.takerTokenFillAmount).toBe(5n);
  });

  it('throws when the selector matches but the payload is truncated', () => {
    expect(() => decodeZeroEx('0x415565b00001')).toThrow(
      /Malformed arguments for transformERC20/
    );
  });

  it('throws when there are too many transformations or fees', () => {
    const many = Array.from(
      { length: MAX_ZEROEX_TRANSFORMATIONS + 1 },
      (_, i) => ({ deploymentNonce: i, data: '0x' as Hex })
    );
    expect(() => decodeZeroEx(transform({ transformations: many }))).toThrow(
      /limit is 256/
    );

    const manyFees = Array.from({ length: MAX_ZEROEX_FEES + 1 }, () => ({
      recipient: FEE_RECIPIENT,
      amount: 1n,
    }));
    expect(() =>
      decodeZeroEx(
        encodeFunctionData({
          abi: ZEROEX_ABI,
          functionName: 'executeMetaTransactionV2',
          args: [
            {
              signer: SIGNER,
              sender: SENDER,
              expirationTimeSeconds: 1n,
              salt: 1n,
              callData: '0x',
              feeToken: TOKEN,
              fees: manyFees,
            },
            eip712Sig,
          ],
        })
      )
    ).toThrow(/limit is 256/);
  });
});
