import { describe, expect, it } from 'vitest';
import {
  encodeAbiParameters,
  encodeFunctionData,
  parseAbi,
  parseAbiParameters,
  type Hex,
} from 'viem';
import {
  MAX_UINT160,
  PHISHING_SPENDER_RISK,
  UNIVERSAL_ROUTER_HIDDEN_GRANT_RISK,
  UNIVERSAL_ROUTER_MSG_SENDER,
  UNLIMITED_PERMIT_RISK,
  diffReports,
  formatDetectedHeader,
  formatReportFooter,
  generateJsonReport,
  isValidReport,
  renderHtmlReport,
} from '../src';

const TOKEN: Hex = '0xcccccccccccccccccccccccccccccccccccccccc';
const RECIPIENT: Hex = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const ROUTER: Hex = '0x7a250d5630b4cf539739df2c5dacb4c659f2488d';
const PHISHING: Hex = '0xbad0000000000000000000000000000000000001';
const SIG: Hex = `0x${'ab'.repeat(65)}`;

const UR_ABI = parseAbi([
  'function execute(bytes commands, bytes[] inputs)',
  'function execute(bytes commands, bytes[] inputs, uint256 deadline)',
]);

function commandsBytes(types: number[]): Hex {
  return `0x${types.map((n) => n.toString(16).padStart(2, '0')).join('')}`;
}

function execute(commands: Hex, inputs: Hex[], deadline?: bigint): Hex {
  if (deadline != null) {
    return encodeFunctionData({
      abi: UR_ABI,
      functionName: 'execute',
      args: [commands, inputs, deadline],
    });
  }
  return encodeFunctionData({
    abi: UR_ABI,
    functionName: 'execute',
    args: [commands, inputs],
  });
}

function permit2Permit(spender: Hex, amount: bigint, expiration: bigint): Hex {
  return encodeAbiParameters(
    parseAbiParameters(
      '((address token, uint160 amount, uint48 expiration, uint48 nonce) details, address spender, uint256 sigDeadline) permitSingle, bytes signature'
    ),
    [
      {
        details: { token: TOKEN, amount, expiration, nonce: 1 },
        spender,
        sigDeadline: 1_900_000_000n,
      },
      SIG,
    ]
  );
}

function unwrap(recipient: Hex, amountMin: bigint): Hex {
  return encodeAbiParameters(
    parseAbiParameters('address recipient, uint256 amountMin'),
    [recipient, amountMin]
  );
}

function sweep(token: Hex, recipient: Hex, amountMin: bigint): Hex {
  return encodeAbiParameters(
    parseAbiParameters('address token, address recipient, uint256 amountMin'),
    [token, recipient, amountMin]
  );
}

function subPlan(commands: Hex, inputs: Hex[]): Hex {
  return encodeAbiParameters(
    parseAbiParameters('bytes commands, bytes[] inputs'),
    [commands, inputs]
  );
}

describe('universal_router reports', () => {
  it('nests a Permit2 permit and rolls its unlimited-permit risk up', () => {
    const report = generateJsonReport(
      execute(commandsBytes([0x0a]), [
        permit2Permit(ROUTER, MAX_UINT160, 1_900_000_000n),
      ])
    )!;
    expect(report.type).toBe('universal_router');
    if (report.type !== 'universal_router') return;
    expect(report.payload.variant).toBe('execute');
    expect(report.payload.commands).toHaveLength(1);
    const command = report.payload.commands[0]!;
    expect(command.kind).toBe('permit2_permit');
    expect(command.spender).toBe(ROUTER);
    expect(command.innerReport?.type).toBe('permit2');
    expect(command.innerReport?.risks).toEqual([UNLIMITED_PERMIT_RISK]);
    expect(report.risks).toEqual([
      UNLIMITED_PERMIT_RISK,
      UNIVERSAL_ROUTER_HIDDEN_GRANT_RISK,
    ]);
    expect(report.severity).toBe('high');
    expect(isValidReport(report)).toBe(true);
  });

  it('keeps a plain unwrap as info and records the router simulation note', () => {
    const report = generateJsonReport(
      execute(commandsBytes([0x0c]), [unwrap(RECIPIENT, 9n)])
    )!;
    expect(report.type).toBe('universal_router');
    if (report.type !== 'universal_router') return;
    expect(report.payload.commands[0]!.kind).toBe('unwrap_weth');
    expect(report.payload.commands[0]!.innerReport).toBeNull();
    expect(report.risks).toEqual([]);
    expect(report.severity).toBe('info');
    expect(
      report.simulation.notes.some((n) => /Universal Router runs each command/.test(n))
    ).toBe(true);
    expect(isValidReport(report)).toBe(true);
  });

  it('carries the deadline variant and lists each command in the text header', () => {
    const report = generateJsonReport(
      execute(commandsBytes([0x0c, 0x0a]), [
        unwrap(RECIPIENT, 1n),
        permit2Permit(ROUTER, 5n, 1_900_000_000n),
      ], 1_900_000_000n)
    )!;
    expect(report.type).toBe('universal_router');
    if (report.type !== 'universal_router') return;
    expect(report.payload.variant).toBe('execute_deadline');
    expect(report.payload.deadline).toBe('1900000000');
    expect(formatDetectedHeader(report)).toEqual([
      'Detected: Uniswap Universal Router execute(bytes,bytes[],uint256)',
      'Commands: 2',
      'Deadline: 1900000000',
      '  [0] unwrap_weth',
      '  [1] permit2_permit',
    ]);
    expect(isValidReport(report)).toBe(true);
  });

  it('nests EXECUTE_SUB_PLAN as another universal_router report', () => {
    const report = generateJsonReport(
      execute(commandsBytes([0x21]), [
        subPlan(commandsBytes([0x0c]), [unwrap(RECIPIENT, 3n)]),
      ])
    )!;
    expect(report.type).toBe('universal_router');
    if (report.type !== 'universal_router') return;
    const inner = report.payload.commands[0]!.innerReport;
    expect(inner?.type).toBe('universal_router');
    if (inner?.type !== 'universal_router') return;
    expect(inner.payload.commands[0]!.kind).toBe('unwrap_weth');
    expect(inner.payload.commands[0]!.recipient).toBe(RECIPIENT);
    expect(report.risks).toEqual([]);
    expect(isValidReport(report)).toBe(true);
  });

  it('rolls a phishing Permit2 spender up from the inner grant', () => {
    const report = generateJsonReport(
      execute(commandsBytes([0x0a]), [
        permit2Permit(PHISHING, 8n, 1_900_000_000n),
      ])
    )!;
    expect(report.risks).toEqual([
      PHISHING_SPENDER_RISK,
      UNIVERSAL_ROUTER_HIDDEN_GRANT_RISK,
    ]);
    expect(report.severity).toBe('high');
    expect(isValidReport(report)).toBe(true);
  });

  it('flags a phishing-listed sweep recipient without treating MSG_SENDER as one', () => {
    const phishing = generateJsonReport(
      execute(commandsBytes([0x04]), [sweep(TOKEN, PHISHING, 1n)])
    )!;
    expect(phishing.risks).toEqual([PHISHING_SPENDER_RISK]);
    expect(phishing.severity).toBe('high');

    const internal = generateJsonReport(
      execute(commandsBytes([0x0c]), [unwrap(UNIVERSAL_ROUTER_MSG_SENDER, 1n)])
    )!;
    expect(internal.risks).toEqual([]);
    expect(internal.severity).toBe('info');
    expect(isValidReport(phishing)).toBe(true);
    expect(isValidReport(internal)).toBe(true);
  });

  it('does not raise a hidden-grant warning for a zero-amount Permit2 permit', () => {
    const report = generateJsonReport(
      execute(commandsBytes([0x0a]), [
        permit2Permit(ROUTER, 0n, 1_900_000_000n),
      ])
    )!;
    expect(report.risks).toEqual([]);
    expect(report.severity).toBe('info');
  });

  it('diffs a new Permit2 spender when the plan adds a permit command', () => {
    const baseline = generateJsonReport(
      execute(commandsBytes([0x0c]), [unwrap(RECIPIENT, 1n)])
    )!;
    const candidate = generateJsonReport(
      execute(commandsBytes([0x0c, 0x0a]), [
        unwrap(RECIPIENT, 1n),
        permit2Permit(ROUTER, 8n, 1_900_000_000n),
      ])
    )!;
    const diff = diffReports(baseline, candidate);
    expect(diff.candidate.type).toBe('universal_router');
    expect(diff.addedAddresses).toEqual([
      { address: ROUTER, role: 'spender' },
    ]);
    expect(
      diff.amountChanges.some((c) => c.field === 'commands[1].amount')
    ).toBe(true);
  });

  it('prints command details in the text footer and HTML table', () => {
    const report = generateJsonReport(
      execute(commandsBytes([0x0a]), [
        permit2Permit(ROUTER, MAX_UINT160, 1_900_000_000n),
      ])
    )!;
    const footer = formatReportFooter(report);
    expect(
      footer.some((line) => line.startsWith('Command [0] permit2_permit'))
    ).toBe(true);
    expect(footer.some((line) => line.includes(ROUTER))).toBe(true);
    const html = renderHtmlReport(report);
    expect(html).toContain('<code>universal_router</code>');
    expect(html).toContain('<th>variant</th><td>execute</td>');
    expect(html).toContain('permit2_permit');
    expect(html).toContain(UNLIMITED_PERMIT_RISK);
    expect(html).not.toContain('<script');
  });
});
