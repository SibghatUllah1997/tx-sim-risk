import { describe, it, expect } from 'vitest';
import {
  APPROVAL_TO_EOA_RISK,
  BLOCKLISTED_SPENDER_RISK,
  BURN_TO_ZERO_ADDRESS_RISK,
  ERC1155_APPROVE_ALL_RISK,
  ERC721_APPROVE_ALL_RISK,
  KNOWN_RISK_IDS,
  PHISHING_SPENDER_RISK,
  RISK_REASONS,
  UNLIMITED_APPROVAL_RISK,
  describeRisks,
  isKnownRiskId,
  reasonForRisk,
} from '../src';

describe('risk reason catalog', () => {
  it('lists every currently emitted risk id exactly once', () => {
    expect([...KNOWN_RISK_IDS].sort()).toEqual(
      [
        UNLIMITED_APPROVAL_RISK,
        BURN_TO_ZERO_ADDRESS_RISK,
        ERC721_APPROVE_ALL_RISK,
        ERC1155_APPROVE_ALL_RISK,
        PHISHING_SPENDER_RISK,
        APPROVAL_TO_EOA_RISK,
        BLOCKLISTED_SPENDER_RISK,
      ].sort()
    );
    expect(new Set(KNOWN_RISK_IDS).size).toBe(KNOWN_RISK_IDS.length);
  });

  it('has a non-empty unique reason for every known id', () => {
    const reasons = KNOWN_RISK_IDS.map((id) => RISK_REASONS[id]);
    for (const reason of reasons) {
      expect(reason.length).toBeGreaterThan(20);
      expect(reason).toMatch(/[.]$/);
    }
    expect(new Set(reasons).size).toBe(reasons.length);
    expect(Object.keys(RISK_REASONS).sort()).toEqual([...KNOWN_RISK_IDS].sort());
  });

  it('looks up known ids and falls back for unknown ones', () => {
    expect(isKnownRiskId(UNLIMITED_APPROVAL_RISK)).toBe(true);
    expect(isKnownRiskId('not_a_real_risk')).toBe(false);
    expect(reasonForRisk(UNLIMITED_APPROVAL_RISK)).toBe(
      RISK_REASONS[UNLIMITED_APPROVAL_RISK]
    );
    expect(reasonForRisk('not_a_real_risk')).toBe(
      'No reason is recorded for risk id not_a_real_risk.'
    );
  });

  it('pairs ids with reasons in the given order, including duplicates', () => {
    const ids = [
      PHISHING_SPENDER_RISK,
      APPROVAL_TO_EOA_RISK,
      PHISHING_SPENDER_RISK,
    ];
    expect(describeRisks(ids)).toEqual([
      { id: PHISHING_SPENDER_RISK, reason: RISK_REASONS[PHISHING_SPENDER_RISK] },
      { id: APPROVAL_TO_EOA_RISK, reason: RISK_REASONS[APPROVAL_TO_EOA_RISK] },
      { id: PHISHING_SPENDER_RISK, reason: RISK_REASONS[PHISHING_SPENDER_RISK] },
    ]);
    expect(describeRisks([])).toEqual([]);
  });
});
