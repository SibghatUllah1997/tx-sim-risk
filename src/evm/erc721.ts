import { decodeSetApprovalForAll } from './approvalForAll';

export const ERC721_APPROVE_ALL_RISK = 'erc721_approve_all';

export type Erc721SetApprovalForAllDecoded = {
  method: 'erc721_setApprovalForAll';
  operator: string;
  approved: boolean;
  isApproveAll: boolean;
};

/**
 * Decode ERC-721 setApprovalForAll(address operator, bool approved).
 * The calldata encoding is shared with ERC-1155; this wrapper labels it as ERC-721.
 */
export function decodeErc721SetApprovalForAll(
  data: string
): Erc721SetApprovalForAllDecoded | null {
  const decoded = decodeSetApprovalForAll(data);
  if (!decoded) return null;
  return {
    method: 'erc721_setApprovalForAll',
    operator: decoded.operator,
    approved: decoded.approved,
    isApproveAll: decoded.approved,
  };
}

/**
 * True when calldata is ERC-721 setApprovalForAll with approved=true.
 * Revocations (approved=false) and non-matching selectors return false.
 */
export function isErc721ApproveAll(data: string): boolean {
  const decoded = decodeErc721SetApprovalForAll(data);
  return decoded?.isApproveAll ?? false;
}

/**
 * Risk ids for an ERC-721 operator grant. Empty when the call is not
 * setApprovalForAll or when it revokes an existing operator.
 */
export function erc721ApproveAllRisks(data: string): string[] {
  return isErc721ApproveAll(data) ? [ERC721_APPROVE_ALL_RISK] : [];
}
