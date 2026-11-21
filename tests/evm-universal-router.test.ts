import { describe, expect, it } from 'vitest';
import {
  encodeAbiParameters,
  encodeFunctionData,
  parseAbi,
  parseAbiParameters,
  toFunctionSelector,
  type Hex,
} from 'viem';
import {
  MAX_UNIVERSAL_ROUTER_COMMANDS,
  UNIVERSAL_ROUTER_ADDRESS_THIS,
  UNIVERSAL_ROUTER_ALLOW_REVERT,
  UNIVERSAL_ROUTER_MSG_SENDER,
  UNIVERSAL_ROUTER_SIGNATURES,
  decodeUniversalRouter,
  isExternalRecipient,
  isPermit2GrantCommand,
} from '../src/evm/universalRouter';

const TOKEN: Hex = '0xcccccccccccccccccccccccccccccccccccccccc';
const TOKEN_OUT: Hex = '0xdddddddddddddddddddddddddddddddddddddddd';
const RECIPIENT: Hex = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const SPENDER: Hex = '0x7a250d5630b4cf539739df2c5dacb4c659f2488d';
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

function v3SwapIn(recipient: Hex, amountIn: bigint, amountOutMin: bigint): Hex {
  return encodeAbiParameters(
    parseAbiParameters(
      'address recipient, uint256 amountIn, uint256 amountOutMin, bytes path, bool payerIsUser'
    ),
    [recipient, amountIn, amountOutMin, '0xabcd', true]
  );
}

function permit2Permit(spender: Hex, amount: bigint, expiration: bigint): Hex {
  return encodeAbiParameters(
    parseAbiParameters(
      '((address token, uint160 amount, uint48 expiration, uint48 nonce) details, address spender, uint256 sigDeadline) permitSingle, bytes signature'
    ),
    [
      {
        details: {
          token: TOKEN,
          amount,
          expiration,
          nonce: 1,
        },
        spender,
        sigDeadline: 1_900_000_000n,
      },
      SIG,
    ]
  );
}

function sweep(token: Hex, recipient: Hex, amountMin: bigint): Hex {
  return encodeAbiParameters(
    parseAbiParameters('address token, address recipient, uint256 amountMin'),
    [token, recipient, amountMin]
  );
}

function unwrap(recipient: Hex, amountMin: bigint): Hex {
  return encodeAbiParameters(
    parseAbiParameters('address recipient, uint256 amountMin'),
    [recipient, amountMin]
  );
}

function subPlan(commands: Hex, inputs: Hex[]): Hex {
  return encodeAbiParameters(
    parseAbiParameters('bytes commands, bytes[] inputs'),
    [commands, inputs]
  );
}

describe('decodeUniversalRouter', () => {
  it('pins execute selectors to the Uniswap Universal Router ABI', () => {
    expect(toFunctionSelector('execute(bytes,bytes[])')).toBe('0x24856bc3');
    expect(toFunctionSelector('execute(bytes,bytes[],uint256)')).toBe(
      '0x3593564c'
    );
  });

  it('returns null for unrelated selectors and short input', () => {
    expect(decodeUniversalRouter('0x095ea7b3')).toBeNull();
    expect(decodeUniversalRouter('0x')).toBeNull();
    expect(decodeUniversalRouter('0x359356')).toBeNull();
  });

  it('rejects non-hex input', () => {
    expect(() => decodeUniversalRouter('zz')).toThrow(/Invalid hex data/);
  });

  it('decodes execute wrapping a V3 exact-in swap', () => {
    const decoded = decodeUniversalRouter(
      execute(commandsBytes([0x00]), [v3SwapIn(RECIPIENT, 100n, 90n)])
    )!;
    expect(decoded.method).toBe('universal_router');
    expect(decoded.variant).toBe('execute');
    expect(decoded.signature).toBe(UNIVERSAL_ROUTER_SIGNATURES.execute);
    expect(decoded.deadline).toBeNull();
    expect(decoded.commands).toHaveLength(1);
    const cmd = decoded.commands[0]!;
    expect(cmd.kind).toBe('v3_swap_exact_in');
    expect(cmd.allowRevert).toBe(false);
    expect(cmd.recipient).toBe(RECIPIENT);
    expect(cmd.amount).toBe(100n);
    expect(cmd.amountMin).toBe(90n);
    expect(cmd.payerIsUser).toBe(true);
    expect(cmd.nested).toBeNull();
    expect(cmd.permit2).toBeNull();
  });

  it('decodes the deadline overload', () => {
    const decoded = decodeUniversalRouter(
      execute(commandsBytes([0x0c]), [unwrap(RECIPIENT, 7n)], 1_900_000_000n)
    )!;
    expect(decoded.variant).toBe('execute_deadline');
    expect(decoded.signature).toBe(UNIVERSAL_ROUTER_SIGNATURES.execute_deadline);
    expect(decoded.deadline).toBe(1_900_000_000n);
    expect(decoded.commands[0]!.kind).toBe('unwrap_weth');
    expect(decoded.commands[0]!.recipient).toBe(RECIPIENT);
    expect(decoded.commands[0]!.amountMin).toBe(7n);
  });

  it('decodes a Permit2 permit command into a permit2 grant', () => {
    const decoded = decodeUniversalRouter(
      execute(commandsBytes([0x0a]), [permit2Permit(SPENDER, 50n, 1_900_000_000n)])
    )!;
    const cmd = decoded.commands[0]!;
    expect(cmd.kind).toBe('permit2_permit');
    expect(cmd.spender).toBe(SPENDER);
    expect(cmd.token).toBe(TOKEN);
    expect(cmd.amount).toBe(50n);
    expect(cmd.permit2).toMatchObject({
      method: 'permit2',
      variant: 'permit',
      spender: SPENDER,
      token: TOKEN,
      amount: 50n,
      isUnlimited: false,
      hasNoExpiry: false,
    });
  });

  it('sets allowRevert from the high bit and keeps the command type', () => {
    const decoded = decodeUniversalRouter(
      execute(commandsBytes([0x04 | UNIVERSAL_ROUTER_ALLOW_REVERT]), [
        sweep(TOKEN, RECIPIENT, 1n),
      ])
    )!;
    const cmd = decoded.commands[0]!;
    expect(cmd.command).toBe(0x84);
    expect(cmd.kind).toBe('sweep');
    expect(cmd.allowRevert).toBe(true);
    expect(cmd.token).toBe(TOKEN);
    expect(cmd.recipient).toBe(RECIPIENT);
  });

  it('recursively decodes EXECUTE_SUB_PLAN', () => {
    const inner = subPlan(commandsBytes([0x0c]), [unwrap(RECIPIENT, 3n)]);
    const decoded = decodeUniversalRouter(
      execute(commandsBytes([0x21]), [inner])
    )!;
    expect(decoded.commands[0]!.kind).toBe('execute_sub_plan');
    const nested = decoded.commands[0]!.nested!;
    expect(nested.variant).toBe('execute');
    expect(nested.commands).toHaveLength(1);
    expect(nested.commands[0]!.kind).toBe('unwrap_weth');
    expect(nested.commands[0]!.recipient).toBe(RECIPIENT);
  });

  it('keeps unknown command types without throwing', () => {
    const decoded = decodeUniversalRouter(
      execute(commandsBytes([0x3f]), ['0xdead' as Hex])
    )!;
    expect(decoded.commands[0]!.kind).toBe('unknown');
    expect(decoded.commands[0]!.recipient).toBeNull();
    expect(decoded.commands[0]!.input).toBe('0xdead');
  });

  it('decodes a V2 swap path and a Permit2 pull in one plan', () => {
    const v2 = encodeAbiParameters(
      parseAbiParameters(
        'address recipient, uint256 amountIn, uint256 amountOutMin, address[] path, bool payerIsUser'
      ),
      [RECIPIENT, 10n, 8n, [TOKEN, TOKEN_OUT], false]
    );
    const pull = encodeAbiParameters(
      parseAbiParameters('address token, address recipient, uint160 amount'),
      [TOKEN, RECIPIENT, 10n]
    );
    const decoded = decodeUniversalRouter(
      execute(commandsBytes([0x08, 0x02]), [v2, pull])
    )!;
    expect(decoded.commands.map((c) => c.kind)).toEqual([
      'v2_swap_exact_in',
      'permit2_transfer_from',
    ]);
    expect(decoded.commands[0]!.token).toBe(TOKEN);
    expect(decoded.commands[0]!.payerIsUser).toBe(false);
    expect(decoded.commands[1]!.amount).toBe(10n);
  });

  it('throws when command and input counts differ', () => {
    expect(() =>
      decodeUniversalRouter(execute(commandsBytes([0x00, 0x04]), [v3SwapIn(RECIPIENT, 1n, 1n)]))
    ).toThrow(/command count 2 does not match 1 inputs/);
  });

  it('throws when a known command has truncated input', () => {
    expect(() =>
      decodeUniversalRouter(execute(commandsBytes([0x04]), ['0x01']))
    ).toThrow(/Malformed arguments/);
  });

  it('throws when the plan is larger than the command cap', () => {
    const types = Array.from({ length: MAX_UNIVERSAL_ROUTER_COMMANDS + 1 }, () => 0x3f);
    const inputs = types.map(() => '0x' as Hex);
    expect(() =>
      decodeUniversalRouter(execute(commandsBytes(types), inputs))
    ).toThrow(/the limit is 256/);
  });
});

describe('universal router helpers', () => {
  it('treats MSG_SENDER, ADDRESS_THIS, and zero as internal', () => {
    expect(isExternalRecipient(null)).toBe(false);
    expect(isExternalRecipient('0x0000000000000000000000000000000000000000')).toBe(
      false
    );
    expect(isExternalRecipient(UNIVERSAL_ROUTER_MSG_SENDER)).toBe(false);
    expect(isExternalRecipient(UNIVERSAL_ROUTER_ADDRESS_THIS)).toBe(false);
    expect(isExternalRecipient(RECIPIENT)).toBe(true);
  });

  it('names Permit2 permit commands as grants', () => {
    expect(isPermit2GrantCommand('permit2_permit')).toBe(true);
    expect(isPermit2GrantCommand('permit2_permit_batch')).toBe(true);
    expect(isPermit2GrantCommand('sweep')).toBe(false);
    expect(isPermit2GrantCommand('v3_swap_exact_in')).toBe(false);
  });
});
