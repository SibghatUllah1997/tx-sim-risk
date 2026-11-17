import { describe, expect, it } from 'vitest';
import { encodeFunctionData, parseAbi, type Hex } from 'viem';
import {
  ERC4337_CALLDATA_APPROVAL_RISK,
  ERC4337_PAYMASTER_RISK,
  MAX_UINT256,
  PHISHING_SPENDER_RISK,
  UNLIMITED_APPROVAL_RISK,
  formatDetectedHeader,
  formatReportFooter,
  generateJsonReport,
  generateJsonReportFromAny,
  isValidReport,
  renderHtmlReport,
} from '../src';

const SENDER = '0x1111111111111111111111111111111111111111';
const TOKEN = '0xcccccccccccccccccccccccccccccccccccccccc';
const ROUTER = '0x7a250d5630b4cf539739df2c5dacb4c659f2488d';
const BENEFICIARY = '0x2222222222222222222222222222222222222222';
const PAYMASTER = '0x3333333333333333333333333333333333333333';
const PHISHING = '0xbad0000000000000000000000000000000000001';
const SIGNATURE: Hex = `0x${'ab'.repeat(65)}`;

const APPROVE_ABI = parseAbi([
  'function approve(address spender, uint256 value)',
]);
const TRANSFER_ABI = parseAbi([
  'function transfer(address to, uint256 value)',
]);
const EXECUTE_ABI = parseAbi([
  'function execute(address dest, uint256 value, bytes func)',
]);
const HANDLE_OPS_V06_ABI = parseAbi([
  'function handleOps((address sender, uint256 nonce, bytes initCode, bytes callData, uint256 callGasLimit, uint256 verificationGasLimit, uint256 preVerificationGas, uint256 maxFeePerGas, uint256 maxPriorityFeePerGas, bytes paymasterAndData, bytes signature)[] ops, address beneficiary)',
]);

function approve(spender: string, amount: bigint): Hex {
  return encodeFunctionData({
    abi: APPROVE_ABI,
    functionName: 'approve',
    args: [spender as Hex, amount],
  });
}

function transfer(to: string, amount: bigint): Hex {
  return encodeFunctionData({
    abi: TRANSFER_ABI,
    functionName: 'transfer',
    args: [to as Hex, amount],
  });
}

function execute(dest: string, func: Hex): Hex {
  return encodeFunctionData({
    abi: EXECUTE_ABI,
    functionName: 'execute',
    args: [dest as Hex, 0n, func],
  });
}

function handleOps(callData: Hex, paymasterAndData: Hex = '0x'): Hex {
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
          signature: SIGNATURE,
        },
      ],
      BENEFICIARY,
    ],
  });
}

describe('erc4337 userop report', () => {
  it('flags an execute-wrapped unlimited approve and matches the schema', () => {
    const report = generateJsonReport(
      handleOps(execute(TOKEN, approve(ROUTER, MAX_UINT256)))
    )!;
    expect(report.type).toBe('erc4337_userop');
    if (report.type !== 'erc4337_userop') return;
    expect(report.payload.version).toBe('v0.6');
    expect(report.payload.beneficiary).toBe(BENEFICIARY);
    expect(report.payload.ops[0]?.sender).toBe(SENDER);
    expect(report.payload.ops[0]?.paymaster).toBeNull();
    expect(report.payload.ops[0]?.calls[0]).toMatchObject({
      target: TOKEN,
      report: expect.objectContaining({ type: 'erc20_approve' }),
    });
    expect(report.risks).toEqual([
      ERC4337_CALLDATA_APPROVAL_RISK,
      UNLIMITED_APPROVAL_RISK,
    ]);
    expect(report.severity).toBe('high');
    expect(isValidReport(report)).toBe(true);
    expect(report.simulation.allowances[0]).toMatchObject({
      owner: SENDER,
      spender: ROUTER,
      newValue: MAX_UINT256.toString(),
    });
    expect(report.simulation.notes.some((note) => /handleOps/.test(note))).toBe(
      true
    );
  });

  it('flags a paymaster and still reports a clean transfer without approval risk', () => {
    const report = generateJsonReport(
      handleOps(execute(TOKEN, transfer(ROUTER, 8n)), `${PAYMASTER}ffff` as Hex)
    )!;
    expect(report.type).toBe('erc4337_userop');
    if (report.type !== 'erc4337_userop') return;
    expect(report.payload.ops[0]?.paymaster).toBe(PAYMASTER);
    expect(report.risks).toEqual([ERC4337_PAYMASTER_RISK]);
    expect(report.severity).toBe('warn');
    expect(report.simulation.balances[0]).toMatchObject({
      account: SENDER,
      delta: '-8',
    });
    expect(isValidReport(report)).toBe(true);
  });

  it('flags a phishing paymaster and a phishing approve inside callData', () => {
    const report = generateJsonReport(
      handleOps(
        execute(TOKEN, approve(PHISHING, 10n)),
        PHISHING as Hex
      )
    )!;
    expect(report.risks).toEqual([
      ERC4337_PAYMASTER_RISK,
      PHISHING_SPENDER_RISK,
      ERC4337_CALLDATA_APPROVAL_RISK,
    ]);
    expect(report.severity).toBe('high');
    expect(isValidReport(report)).toBe(true);
  });

  it('does not flag a revocation as a callData approval', () => {
    const report = generateJsonReport(
      handleOps(execute(TOKEN, approve(ROUTER, 0n)))
    )!;
    expect(report.risks).toEqual([]);
    expect(report.severity).toBe('info');
  });

  it('prints plain-text and HTML output', () => {
    const report = generateJsonReportFromAny(
      handleOps(execute(TOKEN, approve(ROUTER, MAX_UINT256)), PAYMASTER as Hex)
    )!;
    const header = formatDetectedHeader(report);
    expect(header[0]).toBe('Detected: ERC-4337 handleOps (v0.6)');
    expect(header).toContain(`Beneficiary: ${BENEFICIARY}`);
    expect(header.some((line) => line.includes(`paymaster=${PAYMASTER}`))).toBe(
      true
    );
    expect(header.some((line) => line.includes('type=erc20_approve'))).toBe(
      true
    );
    expect(formatReportFooter(report)).toEqual(
      expect.arrayContaining([
        'EntryPoint: v0.6',
        'User operations: 1',
        'Severity: high',
      ])
    );
    const html = renderHtmlReport(report);
    expect(html).toContain('<code>erc4337_userop</code>');
    expect(html).toContain(ERC4337_PAYMASTER_RISK);
    expect(html).toContain(ERC4337_CALLDATA_APPROVAL_RISK);
  });
});
