import { describe, it, expect } from 'vitest';
import { generateJsonReport, pluginDecodeReport } from '../src/report';
import { loadReportSchema } from '../src/schema';
import {
  assertValidReport,
  isValidReport,
  validateJsonSchema,
} from '../src/schemaValidate';

const schema = loadReportSchema();

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function word(hexNoPrefix: string): string {
  return hexNoPrefix.padStart(64, '0');
}

function approve(spenderNo0x: string, amountHex: string): string {
  return `0x095ea7b3${word(`000000000000000000000000${spenderNo0x}`)}${word(amountHex)}`;
}

function transfer(toNo0x: string, amountHex: string): string {
  return `0xa9059cbb${word(`000000000000000000000000${toNo0x}`)}${word(amountHex)}`;
}

describe('validateJsonSchema', () => {
  it('accepts type, enum, required, and additionalProperties: false', () => {
    const local = {
      type: 'object',
      additionalProperties: false,
      required: ['id'],
      properties: {
        id: { type: 'string', enum: ['a', 'b'] },
        n: { type: 'integer', minimum: 0 },
      },
    };
    expect(validateJsonSchema({ id: 'a', n: 1 }, local).valid).toBe(true);
    expect(validateJsonSchema({ id: 'z' }, local).valid).toBe(false);
    expect(validateJsonSchema({ id: 'a', extra: true }, local).valid).toBe(
      false
    );
    expect(validateJsonSchema({ n: 1 }, local).valid).toBe(false);
    expect(validateJsonSchema({ id: 'a', n: 1.5 }, local).valid).toBe(false);
  });

  it('resolves $ref, anyOf, and prefixItems', () => {
    const local = {
      $defs: {
        hex: { type: 'string', pattern: '^0x[0-9a-f]+$' },
      },
      type: 'array',
      minItems: 2,
      maxItems: 2,
      prefixItems: [{ const: 'erc721' }, { $ref: '#/$defs/hex' }],
      items: false,
    };
    expect(validateJsonSchema(['erc721', '0xab'], local).valid).toBe(true);
    expect(validateJsonSchema(['erc721', 'ab'], local).valid).toBe(false);
    expect(validateJsonSchema(['erc721', '0xab', 'x'], local).valid).toBe(
      false
    );
  });

  it('rejects a boolean false schema and accepts true', () => {
    expect(validateJsonSchema({ a: 1 }, true).valid).toBe(true);
    expect(validateJsonSchema({ a: 1 }, false).valid).toBe(false);
  });
});

describe('report schema validation', () => {
  it('accepts approve, transfer, plugin_decode, and the CLI unknown fallback', () => {
    const unlimited = generateJsonReport(approve('7a250d5630b4cf539739df2c5dacb4c659f2488d', 'f'.repeat(64)))!;
    expect(isValidReport(clone(unlimited), schema)).toBe(true);

    const burn = generateJsonReport(transfer('0'.repeat(40), '0a'))!;
    expect(isValidReport(clone(burn), schema)).toBe(true);

    const plugin = pluginDecodeReport(
      { id: 'cosmos', name: 'Cosmos' },
      {
        summary: 'bank send',
        fields: { denom: 'uatom', amount: 12, ibc: false, memo: null },
        risks: ['custom_risk'],
      }
    );
    expect(isValidReport(clone(plugin), schema)).toBe(true);

    expect(
      isValidReport({ type: 'unknown', risks: [], payload: {} }, schema)
    ).toBe(true);
  });

  it('rejects missing severity, extra keys, and a numeric amount', () => {
    const report = clone(
      generateJsonReport(approve('7a250d5630b4cf539739df2c5dacb4c659f2488d', 'f'.repeat(64)))!
    );
    const { severity: _ignored, ...noSeverity } = report;
    expect(isValidReport(noSeverity, schema)).toBe(false);
    expect(isValidReport({ ...report, extra: true }, schema)).toBe(false);

    const badAmount = clone(report);
    if (badAmount.type === 'erc20_approve') {
      (badAmount.payload as { amount: unknown }).amount = 1;
    }
    expect(isValidReport(badAmount, schema)).toBe(false);
  });

  it('assertValidReport throws a pointer-rich error on a bad report', () => {
    expect(() => assertValidReport({ type: 'nope' }, schema)).toThrow(
      /does not match schema/
    );
    expect(() =>
      assertValidReport(generateJsonReport(transfer('aa'.repeat(20), '01'))!, schema)
    ).not.toThrow();
  });
});
