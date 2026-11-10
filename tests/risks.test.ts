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
  RISK_SEVERITIES,
  SOLANA_ATA_MISMATCH_RISK,
  UNLIMITED_APPROVAL_RISK,
  describeRisks,
  highestSeverity,
  isKnownRiskId,
  reasonForRisk,
  severityForRisk,
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
        SOLANA_ATA_MISMATCH_RISK,
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
      {
        id: PHISHING_SPENDER_RISK,
        reason: RISK_REASONS[PHISHING_SPENDER_RISK],
        severity: 'high',
      },
      {
        id: APPROVAL_TO_EOA_RISK,
        reason: RISK_REASONS[APPROVAL_TO_EOA_RISK],
        severity: 'warn',
      },
      {
        id: PHISHING_SPENDER_RISK,
        reason: RISK_REASONS[PHISHING_SPENDER_RISK],
        severity: 'high',
      },
    ]);
    expect(describeRisks([])).toEqual([]);
  });
});

describe('risk severity catalog', () => {
  it('assigns a valid severity to every known id', () => {
    expect(Object.keys(RISK_SEVERITIES).sort()).toEqual(
      [...KNOWN_RISK_IDS].sort()
    );
    for (const id of KNOWN_RISK_IDS) {
      expect(['info', 'warn', 'high']).toContain(RISK_SEVERITIES[id]);
    }
  });

  it('marks drain-capable and untrusted-party grants as high', () => {
    expect(severityForRisk(UNLIMITED_APPROVAL_RISK)).toBe('high');
    expect(severityForRisk(ERC721_APPROVE_ALL_RISK)).toBe('high');
    expect(severityForRisk(ERC1155_APPROVE_ALL_RISK)).toBe('high');
    expect(severityForRisk(PHISHING_SPENDER_RISK)).toBe('high');
    expect(severityForRisk(BLOCKLISTED_SPENDER_RISK)).toBe('high');
  });

  it('marks heuristic EOA grants and burns as warn', () => {
    expect(severityForRisk(APPROVAL_TO_EOA_RISK)).toBe('warn');
    expect(severityForRisk(BURN_TO_ZERO_ADDRESS_RISK)).toBe('warn');
  });

  it('defaults unknown ids to warn so they are not dropped as info', () => {
    expect(severityForRisk('not_a_real_risk')).toBe('warn');
  });

  it('rolls up the highest severity, treating an empty list as info', () => {
    expect(highestSeverity([])).toBe('info');
    expect(highestSeverity([APPROVAL_TO_EOA_RISK])).toBe('warn');
    expect(
      highestSeverity([APPROVAL_TO_EOA_RISK, PHISHING_SPENDER_RISK])
    ).toBe('high');
    expect(
      highestSeverity([BURN_TO_ZERO_ADDRESS_RISK, APPROVAL_TO_EOA_RISK])
    ).toBe('warn');
  });
});

