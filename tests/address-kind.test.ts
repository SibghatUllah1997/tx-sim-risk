import { describe, it, expect } from 'vitest';
import {
  APPROVAL_TO_EOA_RISK,
  DEFAULT_KNOWN_CONTRACTS,
  classifyAddressKind,
  createAddressKindMap,
  eoaApprovalRisks,
  kindFromBytecode,
} from '../src';

const ROUTER = '0x7a250d5630b4cf539739df2c5dacb4c659f2488d';
const RANDOM = '0x1111111111111111111111111111111111111111';
const ZERO = '0x' + '0'.repeat(40);

describe('kindFromBytecode', () => {
  it('treats empty / 0x as EOA and any code as a contract', () => {
    expect(kindFromBytecode('0x')).toBe('eoa');
    expect(kindFromBytecode('')).toBe('eoa');
    expect(kindFromBytecode('0x60806040')).toBe('contract');
    expect(kindFromBytecode('0x00')).toBe('contract');
  });

  it('returns null when bytecode is omitted so callers can fall through', () => {
    expect(kindFromBytecode(undefined)).toBeNull();
    expect(kindFromBytecode(null)).toBeNull();
  });

  it('throws on non-hex bytecode', () => {
    expect(() => kindFromBytecode('0xzz')).toThrowError(/invalid bytecode/i);
  });
});

describe('classifyAddressKind', () => {
  it('classifies default known contracts and leaves strangers unknown', () => {
    expect(classifyAddressKind(ROUTER)).toBe('contract');
    expect(classifyAddressKind(ROUTER.toUpperCase())).toBe('contract');
    expect(classifyAddressKind(RANDOM)).toBe('unknown');
    expect(DEFAULT_KNOWN_CONTRACTS).toContain(ROUTER);
  });

  it('treats the zero address as unknown even when bytecode is supplied', () => {
    expect(classifyAddressKind(ZERO)).toBe('unknown');
    expect(classifyAddressKind(ZERO, { bytecode: '0x' })).toBe('unknown');
    expect(classifyAddressKind(ZERO, { bytecode: '0x6080' })).toBe('unknown');
  });

  it('lets bytecode override the known-address map', () => {
    expect(classifyAddressKind(ROUTER, { bytecode: '0x' })).toBe('eoa');
    expect(classifyAddressKind(RANDOM, { bytecode: '0x60806040' })).toBe(
      'contract'
    );
  });

  it('honors an explicit known map for EOAs and contracts', () => {
    const known = createAddressKindMap([ROUTER], [RANDOM]);
    expect(classifyAddressKind(RANDOM, { known })).toBe('eoa');
    expect(classifyAddressKind(ROUTER, { known })).toBe('contract');
    expect(
      classifyAddressKind('0x2222222222222222222222222222222222222222', {
        known,
      })
    ).toBe('unknown');
  });

  it('throws on malformed addresses and on malformed map entries', () => {
    expect(() => classifyAddressKind('0xshort')).toThrowError(
      /invalid address/i
    );
    expect(() => createAddressKindMap(['0xnope'])).toThrowError(
      /invalid contract address/i
    );
    expect(() => createAddressKindMap([], ['zzz'])).toThrowError(
      /invalid eoa address/i
    );
  });
});

describe('eoaApprovalRisks', () => {
  it('flags only addresses that classify as EOA', () => {
    expect(eoaApprovalRisks(RANDOM, { bytecode: '0x' })).toEqual([
      APPROVAL_TO_EOA_RISK,
    ]);
    expect(eoaApprovalRisks(RANDOM, { bytecode: '0x6080' })).toEqual([]);
    expect(eoaApprovalRisks(ROUTER)).toEqual([]);
    expect(eoaApprovalRisks(RANDOM)).toEqual([]);
  });
});
