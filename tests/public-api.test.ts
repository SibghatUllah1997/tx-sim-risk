import { describe, it, expect } from 'vitest';
import {
  MAX_UINT256,
  ZERO_ADDRESS,
  classifyCliInput,
  decodeErc20Approve,
  extractDataAndChainIdFromRawTx,
  formatPackageIdentity,
  generateJsonReport,
  generateJsonReportFromAny,
  hasFlag,
  isHexString,
  isUnlimitedErc20Approval,
  parseEip1559Fees,
  readPackageVersion,
  stripHexPrefix,
} from '../src';

const SPENDER = '7a250d5630b4cf539739df2c5dacb4c659f2488d';
const APPROVE =
  `0x095ea7b3${'0'.repeat(24)}${SPENDER}${'f'.repeat(64)}`;

describe('public library barrel', () => {
  it('exposes hex helpers, payload classification, and ERC-20 decode', () => {
    expect(stripHexPrefix('0Xab')).toBe('ab');
    expect(isHexString(APPROVE)).toBe(true);
    expect(ZERO_ADDRESS).toHaveLength(42);
    expect(classifyCliInput(APPROVE).kind).toBe('hex');

    const decoded = decodeErc20Approve(APPROVE)!;
    expect(decoded.spender).toBe(`0x${SPENDER}`);
    expect(decoded.amount).toBe(MAX_UINT256);
    expect(isUnlimitedErc20Approval(APPROVE)).toBe(true);
  });

  it('exposes report builders, fee parsing, and package identity', () => {
    const report = generateJsonReport(APPROVE)!;
    expect(report.type).toBe('erc20_approve');
    expect(report.risks).toContain('unlimited_approval');
    expect(generateJsonReportFromAny(APPROVE)?.type).toBe('erc20_approve');

    expect(parseEip1559Fees(APPROVE)).toBeNull();
    expect(extractDataAndChainIdFromRawTx(APPROVE)).toBeNull();
    expect(hasFlag(['--json'], ['--json'])).toBe(true);
    expect(formatPackageIdentity()).toBe(`tx-sim-risk ${readPackageVersion()}`);
  });
});
