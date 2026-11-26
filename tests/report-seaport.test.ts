import { describe, expect, it } from 'vitest';
import { encodeFunctionData, parseAbi, type Hex } from 'viem';
import {
  PHISHING_SPENDER_RISK,
  SEAPORT_HIDDEN_GRANT_RISK,
  SEAPORT_SIGNATURES,
  UNLIMITED_APPROVAL_RISK,
  formatDetectedHeader,
  formatReportFooter,
  generateJsonReport,
  isValidReport,
  lookupAddressLabel,
  renderHtmlReport,
} from '../src';

const NFT: Hex = '0xdddddddddddddddddddddddddddddddddddddddd';
const OFFERER: Hex = '0x1111111111111111111111111111111111111111';
const ZONE: Hex = '0x2222222222222222222222222222222222222222';
const RECIPIENT: Hex = '0x3333333333333333333333333333333333333333';
const ZERO: Hex = '0x0000000000000000000000000000000000000000';
const ROUTER: Hex = '0x7a250d5630b4cf539739df2c5dacb4c659f2488d';
const PHISHING: Hex = '0xbad0000000000000000000000000000000000001';
const SEAPORT_1_5: Hex = '0x00000000000000adc04c56bf30ac9d3c0aaf14dc';
const ZONE_HASH: Hex = `0x${'ab'.repeat(32)}`;
const CONDUIT: Hex = `0x${'cd'.repeat(32)}`;
const ORDER_SIG: Hex = `0x${'11'.repeat(65)}`;
const MAX_UINT256 = (1n << 256n) - 1n;

const ERC20_ABI = parseAbi([
  'function approve(address spender, uint256 value)',
  'function transfer(address to, uint256 value)',
]);
const SEAPORT_ABI = parseAbi([
  'function fulfillOrder(((address offerer, address zone, (uint8 itemType, address token, uint256 identifierOrCriteria, uint256 startAmount, uint256 endAmount)[] offer, (uint8 itemType, address token, uint256 identifierOrCriteria, uint256 startAmount, uint256 endAmount, address recipient)[] consideration, uint8 orderType, uint256 startTime, uint256 endTime, bytes32 zoneHash, uint256 salt, bytes32 conduitKey, uint256 totalOriginalConsiderationItems) parameters, bytes signature) order, bytes32 fulfillerConduitKey)',
  'function fulfillAdvancedOrder(((address offerer, address zone, (uint8 itemType, address token, uint256 identifierOrCriteria, uint256 startAmount, uint256 endAmount)[] offer, (uint8 itemType, address token, uint256 identifierOrCriteria, uint256 startAmount, uint256 endAmount, address recipient)[] consideration, uint8 orderType, uint256 startTime, uint256 endTime, bytes32 zoneHash, uint256 salt, bytes32 conduitKey, uint256 totalOriginalConsiderationItems) parameters, uint120 numerator, uint120 denominator, bytes signature, bytes extraData) advancedOrder, (uint256 orderIndex, uint8 side, uint256 index, uint256 identifier, bytes32[] criteriaProof)[] criteriaResolvers, bytes32 fulfillerConduitKey, address recipient)',
  'function fulfillBasicOrder((address considerationToken, uint256 considerationIdentifier, uint256 considerationAmount, address offerer, address zone, address offerToken, uint256 offerIdentifier, uint256 offerAmount, uint8 basicOrderType, uint256 startTime, uint256 endTime, bytes32 zoneHash, uint256 salt, bytes32 offererConduitKey, bytes32 fulfillerConduitKey, uint256 totalOriginalAdditionalRecipients, (uint256 amount, address recipient)[] additionalRecipients, bytes signature) parameters)',
]);

function approve(spender: Hex, value: bigint): Hex {
  return encodeFunctionData({
    abi: ERC20_ABI,
    functionName: 'approve',
    args: [spender, value],
  });
}

function transfer(to: Hex, value: bigint): Hex {
  return encodeFunctionData({
    abi: ERC20_ABI,
    functionName: 'transfer',
    args: [to, value],
  });
}

const parameters = {
  offerer: OFFERER,
  zone: ZONE,
  offer: [
    {
      itemType: 2,
      token: NFT,
      identifierOrCriteria: 7n,
      startAmount: 1n,
      endAmount: 1n,
    },
  ],
  consideration: [
    {
      itemType: 0,
      token: ZERO,
      identifierOrCriteria: 0n,
      startAmount: 10n,
      endAmount: 10n,
      recipient: OFFERER,
    },
  ],
  orderType: 0,
  startTime: 1_700_000_000n,
  endTime: 1_900_000_000n,
  zoneHash: ZONE_HASH,
  salt: 9n,
  conduitKey: CONDUIT,
  totalOriginalConsiderationItems: 1n,
};

function fulfillOrder(): Hex {
  return encodeFunctionData({
    abi: SEAPORT_ABI,
    functionName: 'fulfillOrder',
    args: [
      {
        parameters,
        signature: ORDER_SIG,
      },
      CONDUIT,
    ],
  });
}

function fulfillOrderWithRecipient(recipient: Hex): Hex {
  return encodeFunctionData({
    abi: SEAPORT_ABI,
    functionName: 'fulfillOrder',
    args: [
      {
        parameters: {
          ...parameters,
          consideration: [
            {
              itemType: 0,
              token: ZERO,
              identifierOrCriteria: 0n,
              startAmount: 10n,
              endAmount: 10n,
              recipient,
            },
          ],
        },
        signature: ORDER_SIG,
      },
      CONDUIT,
    ],
  });
}

function fulfillAdvanced(extraData: Hex = '0x', recipient: Hex = RECIPIENT): Hex {
  return encodeFunctionData({
    abi: SEAPORT_ABI,
    functionName: 'fulfillAdvancedOrder',
    args: [
      {
        parameters,
        numerator: 1n,
        denominator: 1n,
        signature: ORDER_SIG,
        extraData,
      },
      [],
      CONDUIT,
      recipient,
    ],
  });
}

describe('seaport reports', () => {
  it('nests an inner approve on extraData and rolls its unlimited-approval risk up', () => {
    const report = generateJsonReport(
      fulfillAdvanced(approve(ROUTER, MAX_UINT256))
    )!;
    expect(report.type).toBe('seaport');
    if (report.type !== 'seaport') return;
    expect(report.payload.variant).toBe('fulfill_advanced_order');
    expect(report.payload.offerer).toBe(OFFERER);
    expect(report.payload.recipient).toBe(RECIPIENT);
    expect(report.payload.extraReport?.type).toBe('erc20_approve');
    expect(report.payload.extraReport?.risks).toEqual([UNLIMITED_APPROVAL_RISK]);
    expect(report.risks).toEqual([
      UNLIMITED_APPROVAL_RISK,
      SEAPORT_HIDDEN_GRANT_RISK,
    ]);
    expect(report.severity).toBe('high');
    expect(report.payload.extraDepthLimited).toBe(false);
    expect(isValidReport(report)).toBe(true);
  });

  it('keeps a plain inner transfer as info and records the advanced-order note', () => {
    const report = generateJsonReport(fulfillAdvanced(transfer(RECIPIENT, 9n)))!;
    expect(report.type).toBe('seaport');
    if (report.type !== 'seaport') return;
    expect(report.payload.extraReport?.type).toBe('erc20_transfer');
    expect(report.risks).toEqual([]);
    expect(report.severity).toBe('info');
    expect(
      report.simulation.notes.some((n) => /fulfillAdvancedOrder/.test(n))
    ).toBe(true);
    expect(isValidReport(report)).toBe(true);
  });

  it('lists fulfillOrder fields in the text header', () => {
    const report = generateJsonReport(fulfillOrder())!;
    expect(report.type).toBe('seaport');
    expect(formatDetectedHeader(report)).toEqual([
      `Detected: Seaport ${SEAPORT_SIGNATURES.fulfill_order}`,
      `Offerer: ${OFFERER}`,
      'Offer items: 1',
      'Consideration items: 1',
    ]);
    expect(report.risks).toEqual([]);
    expect(isValidReport(report)).toBe(true);
  });

  it('does not raise a hidden-grant warning for a revoke', () => {
    const report = generateJsonReport(fulfillAdvanced(approve(ROUTER, 0n)))!;
    expect(report.risks).toEqual([]);
    expect(report.severity).toBe('info');
  });

  it('flags a phishing-listed consideration recipient', () => {
    const report = generateJsonReport(fulfillOrderWithRecipient(PHISHING))!;
    expect(report.type).toBe('seaport');
    expect(report.risks).toEqual([PHISHING_SPENDER_RISK]);
    expect(report.severity).toBe('high');
    expect(isValidReport(report)).toBe(true);
  });

  it('flags a phishing-listed advanced-order leftover recipient', () => {
    const report = generateJsonReport(fulfillAdvanced('0x', PHISHING))!;
    expect(report.type).toBe('seaport');
    if (report.type !== 'seaport') return;
    expect(report.payload.recipient).toBe(PHISHING);
    expect(report.risks).toEqual([PHISHING_SPENDER_RISK]);
    expect(report.severity).toBe('high');
    expect(isValidReport(report)).toBe(true);
  });

  it('flags a phishing-listed basic-order additional recipient', () => {
    const report = generateJsonReport(
      encodeFunctionData({
        abi: SEAPORT_ABI,
        functionName: 'fulfillBasicOrder',
        args: [
          {
            considerationToken: ZERO,
            considerationIdentifier: 0n,
            considerationAmount: 10n,
            offerer: OFFERER,
            zone: ZONE,
            offerToken: NFT,
            offerIdentifier: 7n,
            offerAmount: 1n,
            basicOrderType: 0,
            startTime: 1_700_000_000n,
            endTime: 1_900_000_000n,
            zoneHash: ZONE_HASH,
            salt: 9n,
            offererConduitKey: CONDUIT,
            fulfillerConduitKey: CONDUIT,
            totalOriginalAdditionalRecipients: 1n,
            additionalRecipients: [{ amount: 1n, recipient: PHISHING }],
            signature: ORDER_SIG,
          },
        ],
      })
    )!;
    expect(report.type).toBe('seaport');
    expect(report.risks).toEqual([PHISHING_SPENDER_RISK]);
    expect(report.severity).toBe('high');
    expect(lookupAddressLabel(SEAPORT_1_5)).toEqual({
      name: 'Seaport 1.5',
      kind: 'router',
    });
    expect(isValidReport(report)).toBe(true);
  });

  it('prints nested extraData details in the text footer and HTML table', () => {
    const report = generateJsonReport(
      fulfillAdvanced(approve(ROUTER, MAX_UINT256))
    )!;
    const footer = formatReportFooter(report);
    expect(
      footer.some((line) =>
        line.startsWith('Extra data: erc20_approve [high:')
      )
    ).toBe(true);
    const html = renderHtmlReport(report);
    expect(html).toContain('<code>seaport</code>');
    expect(html).toContain('<th>variant</th><td>fulfill_advanced_order</td>');
    expect(html).toContain('extra data');
    expect(html).toContain(UNLIMITED_APPROVAL_RISK);
    expect(html).toContain(SEAPORT_HIDDEN_GRANT_RISK);
    expect(html).not.toContain('<script');
  });
});
