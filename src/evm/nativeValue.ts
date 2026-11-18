/**
 * Native ETH value handling for raw transactions.
 *
 * A raw tx with empty calldata is a plain value transfer. A raw tx that
 * attaches value to a call into a function the standards define as
 * non-payable (ERC-20, permits, NFT operator grants, EntryPoint
 * `handleOps`) is suspicious: an honest contract reverts, so the value is
 * either a mistake or the target is not the contract it claims to be.
 */

/** Risk id when native value rides along with a non-payable standard call. */
export const NATIVE_VALUE_NONPAYABLE_CALL_RISK = 'native_value_nonpayable_call';

/**
 * Report types whose decoded function is non-payable by its standard.
 * Router `multicall` and unknown ABI calls are left out: both can be
 * payable on purpose.
 */
export const NONPAYABLE_REPORT_TYPES: readonly string[] = Object.freeze([
  'erc20_approve',
  'erc20_permit',
  'permit2',
  'erc20_transfer',
  'erc20_increaseAllowance',
  'erc20_decreaseAllowance',
  'nft_setApprovalForAll',
  'erc4337_userop',
]);

export function isNonPayableReportType(type: string): boolean {
  return NONPAYABLE_REPORT_TYPES.includes(type);
}

/** Risks for `value` wei attached to a call decoded as `reportType`. */
export function nativeValueCallRisks(reportType: string, value: bigint): string[] {
  return value > 0n && isNonPayableReportType(reportType)
    ? [NATIVE_VALUE_NONPAYABLE_CALL_RISK]
    : [];
}
