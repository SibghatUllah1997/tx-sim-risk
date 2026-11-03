import { decodeSetApprovalForAll } from './approvalForAll';

export type Erc721SetApprovalForAllDecoded = {
  method: 'erc721_setApprovalForAll';
  operator: string;
  approved: boolean;
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
  };
}
