import { BLOCKLISTED_SPENDER_RISK } from './config';
import { APPROVAL_TO_EOA_RISK } from './evm/addressKind';
import { ERC1155_APPROVE_ALL_RISK } from './evm/erc1155';
import { ERC721_APPROVE_ALL_RISK } from './evm/erc721';
import { UNLIMITED_PERMIT_RISK } from './evm/permit';
import { PHISHING_SPENDER_RISK } from './evm/phishing';
import { SOLANA_ATA_MISMATCH_RISK } from './solana/ata';
import { SOLANA_SUSPICIOUS_CPI_RISK } from './solana/cpi';

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
  SOLANA_ATA_MISMATCH_RISK,
  SOLANA_SUSPICIOUS_CPI_RISK,
  UNLIMITED_PERMIT_RISK,
] as const;

export type KnownRiskId = (typeof KNOWN_RISK_IDS)[number];

/**
 * Output severity for a finding. `info` is reserved for reports with no
 * risks (and for future informational notes). `warn` is a heuristic or
 * easily reversible action. `high` is a grant or transfer that can drain
 * assets or targets an explicitly untrusted party.
 */
export type RiskSeverity = 'info' | 'warn' | 'high';

export type RiskDetail = {
  id: string;
  reason: string;
  severity: RiskSeverity;
};

export const RISK_SEVERITY_RANK: Readonly<Record<RiskSeverity, number>> =
  Object.freeze({
    info: 0,
    warn: 1,
    high: 2,
  });

/**
 * Stable severity for each known risk id. Amount-based and threat-intel
 * hits are `high`; heuristic EOA grants and burns (often intentional)
 * are `warn`.
 */
export const RISK_SEVERITIES: Readonly<Record<KnownRiskId, RiskSeverity>> =
  Object.freeze({
    [UNLIMITED_APPROVAL_RISK]: 'high',
    [BURN_TO_ZERO_ADDRESS_RISK]: 'warn',
    [ERC721_APPROVE_ALL_RISK]: 'high',
    [ERC1155_APPROVE_ALL_RISK]: 'high',
    [PHISHING_SPENDER_RISK]: 'high',
    [APPROVAL_TO_EOA_RISK]: 'warn',
    [BLOCKLISTED_SPENDER_RISK]: 'high',
    [SOLANA_ATA_MISMATCH_RISK]: 'warn',
    [SOLANA_SUSPICIOUS_CPI_RISK]: 'high',
    [UNLIMITED_PERMIT_RISK]: 'high',
  });

/**
 * Severity for a risk id. Unknown ids default to `warn` so a newer
 * producer cannot be silently treated as informational.
 */
export function severityForRisk(id: string): RiskSeverity {
  if (isKnownRiskId(id)) return RISK_SEVERITIES[id];
  return 'warn';
}

/**
 * Highest severity among `ids`. An empty list is `info` so a clean
 * report still has a defined roll-up.
 */
export function highestSeverity(ids: readonly string[]): RiskSeverity {
  let max: RiskSeverity = 'info';
  for (const id of ids) {
    const next = severityForRisk(id);
    if (RISK_SEVERITY_RANK[next] > RISK_SEVERITY_RANK[max]) max = next;
  }
  return max;
}

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
  [SOLANA_ATA_MISMATCH_RISK]:
    'An associated token account instruction names an account that is not the address derived from its wallet, mint, and token program.',
  [SOLANA_SUSPICIOUS_CPI_RISK]:
    'The transaction invokes, or can cross-program-invoke into, a program on the built-in list of known-bad Solana program ids.',
  [UNLIMITED_PERMIT_RISK]:
    "A signed permit grants the spender the maximum allowance, so anyone holding the signature can let it move the owner's entire token balance.",
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

/** Pair each risk id with its reason and severity, preserving input order. */
export function describeRisks(ids: readonly string[]): RiskDetail[] {
  return ids.map((id) => ({
    id,
    reason: reasonForRisk(id),
    severity: severityForRisk(id),
  }));
}
