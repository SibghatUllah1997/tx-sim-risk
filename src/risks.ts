import { BLOCKLISTED_SPENDER_RISK } from './config';
import { APPROVAL_TO_EOA_RISK } from './evm/addressKind';
import { ERC1155_APPROVE_ALL_RISK } from './evm/erc1155';
import { ERC721_APPROVE_ALL_RISK } from './evm/erc721';
import { PHISHING_SPENDER_RISK } from './evm/phishing';

/** Risk id emitted when an ERC-20 approve uses the maximum uint256 amount. */
export const UNLIMITED_APPROVAL_RISK = 'unlimited_approval';

/** Risk id emitted when an ERC-20 transfer sends tokens to the zero address. */
export const BURN_TO_ZERO_ADDRESS_RISK = 'burn_to_zero_address';

export const KNOWN_RISK_IDS = [
  UNLIMITED_APPROVAL_RISK,
  BURN_TO_ZERO_ADDRESS_RISK,
  ERC721_APPROVE_ALL_RISK,
  ERC1155_APPROVE_ALL_RISK,
  PHISHING_SPENDER_RISK,
  APPROVAL_TO_EOA_RISK,
  BLOCKLISTED_SPENDER_RISK,
] as const;

export type KnownRiskId = (typeof KNOWN_RISK_IDS)[number];

export type RiskDetail = {
  id: string;
  reason: string;
};

/**
 * Plain-English explanation for each risk id the decoder currently emits.
 * Keep these stable: reports and CLI text quote them directly.
 */
export const RISK_REASONS: Readonly<Record<KnownRiskId, string>> = Object.freeze({
  [UNLIMITED_APPROVAL_RISK]:
    "The spender is approved for the maximum uint256 amount, so it can move the holder's entire token balance until the allowance is revoked.",
  [BURN_TO_ZERO_ADDRESS_RISK]:
    'Tokens are sent to the zero address, which permanently removes them from circulation.',
  [ERC721_APPROVE_ALL_RISK]:
    'The operator is approved for every ERC-721 token the holder owns in this collection, not just a single token id.',
  [ERC1155_APPROVE_ALL_RISK]:
    'The operator is approved for every ERC-1155 token id the holder owns in this collection.',
  [PHISHING_SPENDER_RISK]:
    'The spender or operator is on the built-in list of known phishing addresses.',
  [APPROVAL_TO_EOA_RISK]:
    'The spender or operator is an externally owned account rather than a contract, which is a common pattern in approval-phishing scams.',
  [BLOCKLISTED_SPENDER_RISK]:
    'The spender or operator is on your configured block list.',
});

export function isKnownRiskId(id: string): id is KnownRiskId {
  return (KNOWN_RISK_IDS as readonly string[]).includes(id);
}

/**
 * Human-readable reason for a risk id. Unknown ids get a fallback string
 * instead of throwing, so a newer report consumer can still print something.
 */
export function reasonForRisk(id: string): string {
  if (isKnownRiskId(id)) return RISK_REASONS[id];
  return `No reason is recorded for risk id ${id}.`;
}

/** Pair each risk id with its reason, preserving input order. */
export function describeRisks(ids: readonly string[]): RiskDetail[] {
  return ids.map((id) => ({ id, reason: reasonForRisk(id) }));
}
