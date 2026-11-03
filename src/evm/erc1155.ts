import { decodeSetApprovalForAll } from './approvalForAll';

export const ERC1155_APPROVE_ALL_RISK = 'erc1155_approve_all';

export type Erc1155SetApprovalForAllDecoded = {
  method: 'erc1155_setApprovalForAll';
  operator: string;
  approved: boolean;
  isApproveAll: boolean;
};

/**
 * Decode ERC-1155 setApprovalForAll(address operator, bool approved).
 * Selector and ABI match ERC-721; this wrapper labels the call as ERC-1155.
 */
export function decodeErc1155SetApprovalForAll(
  data: string
): Erc1155SetApprovalForAllDecoded | null {
  const decoded = decodeSetApprovalForAll(data);
  if (!decoded) return null;
  return {
    method: 'erc1155_setApprovalForAll',
    operator: decoded.operator,
    approved: decoded.approved,
    isApproveAll: decoded.approved,
  };
}

/**
 * True when calldata is ERC-1155 setApprovalForAll with approved=true.
 */
export function isErc1155ApproveAll(data: string): boolean {
  const decoded = decodeErc1155SetApprovalForAll(data);
  return decoded?.isApproveAll ?? false;
}

/**
 * Risk ids for an ERC-1155 operator grant. Empty on revocations and
 * non-matching selectors.
 */
export function erc1155ApproveAllRisks(data: string): string[] {
  return isErc1155ApproveAll(data) ? [ERC1155_APPROVE_ALL_RISK] : [];
}
