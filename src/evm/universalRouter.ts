import {
  decodeAbiParameters,
  decodeFunctionData,
  parseAbi,
  parseAbiParameters,
  type Hex,
} from 'viem';
import { isHexString, MAX_UINT256, stripHexPrefix } from './hex';
import {
  MAX_UINT48,
  MAX_UINT160,
  type Permit2Allowance,
  type Permit2Decoded,
} from './permit2';

/**
 * Uniswap Universal Router `execute` packs a byte per command. Bit 7 means
 * the command may revert without failing the whole plan.
 */
export const UNIVERSAL_ROUTER_ALLOW_REVERT = 0x80;

/** Low 6 bits select the command type (Uniswap Commands.sol). */
export const UNIVERSAL_ROUTER_COMMAND_TYPE_MASK = 0x3f;

/** Router-internal "recipient": the Universal Router itself. */
export const UNIVERSAL_ROUTER_ADDRESS_THIS =
  '0x0000000000000000000000000000000000000002';

/** Router-internal "recipient": `msg.sender` of `execute`. */
export const UNIVERSAL_ROUTER_MSG_SENDER =
  '0x0000000000000000000000000000000000000001';

/** Plans larger than this are rejected rather than analyzed partially. */
export const MAX_UNIVERSAL_ROUTER_COMMANDS = 256;

/** Nested `EXECUTE_SUB_PLAN` deeper than this is rejected at decode time. */
export const MAX_UNIVERSAL_ROUTER_DECODE_DEPTH = 8;

export type UniversalRouterVariant = 'execute' | 'execute_deadline';

/**
 * Named Uniswap Commands.sol values. Unknown bytes stay `unknown` so a
 * newer router can still be listed without failing the decode.
 */
export type UniversalRouterCommandKind =
  | 'v3_swap_exact_in'
  | 'v3_swap_exact_out'
  | 'permit2_transfer_from'
  | 'permit2_permit_batch'
  | 'sweep'
  | 'transfer'
  | 'pay_portion'
  | 'v2_swap_exact_in'
  | 'v2_swap_exact_out'
  | 'permit2_permit'
  | 'wrap_eth'
  | 'unwrap_weth'
  | 'permit2_transfer_from_batch'
  | 'balance_check_erc20'
  | 'v4_swap'
  | 'v3_position_manager_permit'
  | 'v3_position_manager_call'
  | 'v4_initialize_pool'
  | 'v4_position_manager_call'
  | 'execute_sub_plan'
  | 'unknown';

export type UniversalRouterCommand = {
  index: number;
  /** Raw command byte, including the allow-revert flag when set. */
  command: number;
  kind: UniversalRouterCommandKind;
  allowRevert: boolean;
  /** ABI-encoded input for this command, 0x-prefixed lowercase. */
  input: string;
  recipient: string | null;
  token: string | null;
  amount: bigint | null;
  amountMin: bigint | null;
  payerIsUser: boolean | null;
  spender: string | null;
  /** Nested plan recovered from `EXECUTE_SUB_PLAN`. */
  nested: UniversalRouterDecoded | null;
  /** Permit2 grant recovered from `PERMIT2_PERMIT` / `PERMIT2_PERMIT_BATCH`. */
  permit2: Permit2Decoded | null;
};

export type UniversalRouterDecoded = {
  method: 'universal_router';
  variant: UniversalRouterVariant;
  signature: string;
  deadline: bigint | null;
  commands: UniversalRouterCommand[];
};

const ABI_TEXT: Readonly<Record<UniversalRouterVariant, string>> = Object.freeze({
  execute: 'function execute(bytes commands, bytes[] inputs)',
  execute_deadline:
    'function execute(bytes commands, bytes[] inputs, uint256 deadline)',
});

export const UNIVERSAL_ROUTER_SIGNATURES: Readonly<
  Record<UniversalRouterVariant, string>
> = Object.freeze({
  execute: 'execute(bytes,bytes[])',
  execute_deadline: 'execute(bytes,bytes[],uint256)',
});

const EXECUTE_ABI = parseAbi([
  ABI_TEXT.execute,
  ABI_TEXT.execute_deadline,
]);

/** Command type (masked) -> kind. Numbers match Commands.sol. */
const KIND_BY_TYPE: Readonly<Record<number, UniversalRouterCommandKind>> =
  Object.freeze({
    0x00: 'v3_swap_exact_in',
    0x01: 'v3_swap_exact_out',
    0x02: 'permit2_transfer_from',
    0x03: 'permit2_permit_batch',
    0x04: 'sweep',
    0x05: 'transfer',
    0x06: 'pay_portion',
    0x08: 'v2_swap_exact_in',
    0x09: 'v2_swap_exact_out',
    0x0a: 'permit2_permit',
    0x0b: 'wrap_eth',
    0x0c: 'unwrap_weth',
    0x0d: 'permit2_transfer_from_batch',
    0x0e: 'balance_check_erc20',
    0x10: 'v4_swap',
    0x11: 'v3_position_manager_permit',
    0x12: 'v3_position_manager_call',
    0x13: 'v4_initialize_pool',
    0x14: 'v4_position_manager_call',
    0x21: 'execute_sub_plan',
  });

const SELECTOR_VARIANT: Readonly<Record<string, UniversalRouterVariant>> =
  Object.freeze({
    '24856bc3': 'execute',
    '3593564c': 'execute_deadline',
  });

function asHex(value: string): string {
  const hex = stripHexPrefix(value).toLowerCase();
  return hex.length === 0 ? '0x' : `0x${hex}`;
}

function asAddress(value: string): string {
  return `0x${stripHexPrefix(value).toLowerCase()}`;
}

function asBigint(value: unknown): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isInteger(value)) return BigInt(value);
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return BigInt(value);
  throw new Error('expected integer');
}

function decodeParams<T extends readonly unknown[]>(
  types: string,
  data: Hex,
  signature: string
): T {
  try {
    return decodeAbiParameters(parseAbiParameters(types), data) as unknown as T;
  } catch {
    throw new Error(`Malformed arguments for ${signature}`);
  }
}

function emptyCommand(
  index: number,
  command: number,
  kind: UniversalRouterCommandKind,
  input: string
): UniversalRouterCommand {
  return {
    index,
    command,
    kind,
    allowRevert: (command & UNIVERSAL_ROUTER_ALLOW_REVERT) !== 0,
    input,
    recipient: null,
    token: null,
    amount: null,
    amountMin: null,
    payerIsUser: null,
    spender: null,
    nested: null,
    permit2: null,
  };
}

function hasOpenDeadline(deadline: bigint | null): boolean {
  return deadline != null && deadline === MAX_UINT256;
}

function hasOpenExpiration(expiration: bigint | null): boolean {
  return expiration != null && expiration === MAX_UINT48;
}

function finishPermit2(
  partial: Omit<Permit2Decoded, 'method' | 'isUnlimited' | 'hasNoExpiry'>
): Permit2Decoded {
  const allowances = partial.allowances;
  return {
    ...partial,
    method: 'permit2',
    isUnlimited:
      partial.amount === MAX_UINT160 ||
      allowances.some((item) => item.amount === MAX_UINT160),
    hasNoExpiry:
      hasOpenDeadline(partial.deadline) ||
      allowances.some((item) => hasOpenExpiration(item.expiration)),
  };
}

function decodePermit2Permit(
  input: Hex,
  signature: string
): { decoded: Permit2Decoded; spender: string; token: string; amount: bigint } {
  const [permitSingle] = decodeParams<
    readonly [
      {
        details: {
          token: string;
          amount: bigint | number;
          expiration: bigint | number;
          nonce: bigint | number;
        };
        spender: string;
        sigDeadline: bigint | number;
      },
    ]
  >(
    '((address token, uint160 amount, uint48 expiration, uint48 nonce) details, address spender, uint256 sigDeadline) permitSingle, bytes signature',
    input,
    signature
  );
  const token = asAddress(permitSingle.details.token);
  const amount = asBigint(permitSingle.details.amount);
  const expiration = asBigint(permitSingle.details.expiration);
  const nonce = asBigint(permitSingle.details.nonce);
  const spender = asAddress(permitSingle.spender);
  const deadline = asBigint(permitSingle.sigDeadline);
  const allowances: Permit2Allowance[] = [
    { token, amount, expiration, nonce },
  ];
  return {
    decoded: finishPermit2({
      variant: 'permit',
      owner: null,
      spender,
      token,
      amount,
      expiration,
      deadline,
      nonce,
      to: null,
      requestedAmount: null,
      allowances,
    }),
    spender,
    token,
    amount,
  };
}

function decodePermit2PermitBatch(
  input: Hex,
  signature: string
): { decoded: Permit2Decoded; spender: string; token: string; amount: bigint } {
  const [permitBatch] = decodeParams<
    readonly [
      {
        details: readonly {
          token: string;
          amount: bigint | number;
          expiration: bigint | number;
          nonce: bigint | number;
        }[];
        spender: string;
        sigDeadline: bigint | number;
      },
    ]
  >(
    '((address token, uint160 amount, uint48 expiration, uint48 nonce)[] details, address spender, uint256 sigDeadline) permitBatch, bytes signature',
    input,
    signature
  );
  if (permitBatch.details.length === 0) {
    throw new Error(`Malformed arguments for ${signature}`);
  }
  const allowances: Permit2Allowance[] = permitBatch.details.map((item) => ({
    token: asAddress(item.token),
    amount: asBigint(item.amount),
    expiration: asBigint(item.expiration),
    nonce: asBigint(item.nonce),
  }));
  const first = allowances[0]!;
  const spender = asAddress(permitBatch.spender);
  const deadline = asBigint(permitBatch.sigDeadline);
  return {
    decoded: finishPermit2({
      variant: 'permit_batch',
      owner: null,
      spender,
      token: first.token,
      amount: first.amount,
      expiration: first.expiration,
      deadline,
      nonce: first.nonce,
      to: null,
      requestedAmount: null,
      allowances,
    }),
    spender,
    token: first.token,
    amount: first.amount,
  };
}

function decodeSwapV3(
  input: Hex,
  signature: string
): Pick<
  UniversalRouterCommand,
  'recipient' | 'amount' | 'amountMin' | 'payerIsUser'
> {
  const [recipient, amount, bound, , payerIsUser] = decodeParams<
    readonly [string, bigint, bigint, Hex, boolean]
  >(
    'address recipient, uint256 amountIn, uint256 amountOutMin, bytes path, bool payerIsUser',
    input,
    signature
  );
  return {
    recipient: asAddress(recipient),
    amount,
    amountMin: bound,
    payerIsUser,
  };
}

function decodeSwapV2(
  input: Hex,
  signature: string
): Pick<
  UniversalRouterCommand,
  'recipient' | 'token' | 'amount' | 'amountMin' | 'payerIsUser'
> {
  const [recipient, amount, bound, path, payerIsUser] = decodeParams<
    readonly [string, bigint, bigint, readonly string[], boolean]
  >(
    'address recipient, uint256 amountIn, uint256 amountOutMin, address[] path, bool payerIsUser',
    input,
    signature
  );
  return {
    recipient: asAddress(recipient),
    token: path.length > 0 ? asAddress(path[0]!) : null,
    amount,
    amountMin: bound,
    payerIsUser,
  };
}

function fillKnownCommand(
  cmd: UniversalRouterCommand,
  signature: string,
  depth: number
): UniversalRouterCommand {
  const input = cmd.input as Hex;
  switch (cmd.kind) {
    case 'v3_swap_exact_in':
    case 'v3_swap_exact_out': {
      const decoded = decodeSwapV3(input, signature);
      return { ...cmd, ...decoded };
    }
    case 'v2_swap_exact_in':
    case 'v2_swap_exact_out': {
      const decoded = decodeSwapV2(input, signature);
      return { ...cmd, ...decoded };
    }
    case 'permit2_transfer_from': {
      const [token, recipient, amount] = decodeParams<
        readonly [string, string, bigint]
      >('address token, address recipient, uint160 amount', input, signature);
      return {
        ...cmd,
        token: asAddress(token),
        recipient: asAddress(recipient),
        amount: asBigint(amount),
      };
    }
    case 'permit2_transfer_from_batch': {
      const [batch] = decodeParams<
        readonly [
          readonly {
            from: string;
            to: string;
            amount: bigint | number;
            token: string;
          }[],
        ]
      >(
        '(address from, address to, uint160 amount, address token)[] batchDetails',
        input,
        signature
      );
      const first = batch[0];
      return {
        ...cmd,
        token: first ? asAddress(first.token) : null,
        recipient: first ? asAddress(first.to) : null,
        amount: first ? asBigint(first.amount) : null,
      };
    }
    case 'permit2_permit': {
      const permit = decodePermit2Permit(input, signature);
      return {
        ...cmd,
        spender: permit.spender,
        token: permit.token,
        amount: permit.amount,
        permit2: permit.decoded,
      };
    }
    case 'permit2_permit_batch': {
      const permit = decodePermit2PermitBatch(input, signature);
      return {
        ...cmd,
        spender: permit.spender,
        token: permit.token,
        amount: permit.amount,
        permit2: permit.decoded,
      };
    }
    case 'sweep':
    case 'transfer':
    case 'pay_portion': {
      const [token, recipient, amount] = decodeParams<
        readonly [string, string, bigint]
      >('address token, address recipient, uint256 amount', input, signature);
      return {
        ...cmd,
        token: asAddress(token),
        recipient: asAddress(recipient),
        amount,
        amountMin: cmd.kind === 'sweep' ? amount : null,
      };
    }
    case 'wrap_eth':
    case 'unwrap_weth': {
      const [recipient, amount] = decodeParams<readonly [string, bigint]>(
        'address recipient, uint256 amount',
        input,
        signature
      );
      return {
        ...cmd,
        recipient: asAddress(recipient),
        amount,
        amountMin: cmd.kind === 'unwrap_weth' ? amount : null,
      };
    }
    case 'balance_check_erc20': {
      const [, token, amount] = decodeParams<readonly [string, string, bigint]>(
        'address owner, address token, uint256 minBalance',
        input,
        signature
      );
      return { ...cmd, token: asAddress(token), amount };
    }
    case 'execute_sub_plan': {
      const [commands, inputs] = decodeParams<readonly [Hex, readonly Hex[]]>(
        'bytes commands, bytes[] inputs',
        input,
        signature
      );
      return {
        ...cmd,
        nested: {
          method: 'universal_router',
          variant: 'execute',
          signature: UNIVERSAL_ROUTER_SIGNATURES.execute,
          deadline: null,
          commands: parseCommandList(commands, inputs, signature, depth + 1),
        },
      };
    }
    default:
      return cmd;
  }
}

function parseCommandList(
  commands: string,
  inputs: readonly string[],
  signature: string,
  depth: number
): UniversalRouterCommand[] {
  if (depth > MAX_UNIVERSAL_ROUTER_DECODE_DEPTH) {
    throw new Error(`Universal Router plan nested deeper than ${MAX_UNIVERSAL_ROUTER_DECODE_DEPTH}`);
  }
  const bytes = stripHexPrefix(asHex(commands));
  if (bytes.length % 2 !== 0) {
    throw new Error(`Malformed arguments for ${signature}`);
  }
  const count = bytes.length / 2;
  if (count !== inputs.length) {
    throw new Error(
      `Universal Router command count ${count} does not match ${inputs.length} inputs`
    );
  }
  if (count > MAX_UNIVERSAL_ROUTER_COMMANDS) {
    throw new Error(
      `Plan has ${count} commands; the limit is ${MAX_UNIVERSAL_ROUTER_COMMANDS}`
    );
  }
  const parsed: UniversalRouterCommand[] = [];
  for (let i = 0; i < count; i++) {
    const command = Number.parseInt(bytes.slice(i * 2, i * 2 + 2), 16);
    const type = command & UNIVERSAL_ROUTER_COMMAND_TYPE_MASK;
    const kind = KIND_BY_TYPE[type] ?? 'unknown';
    const input = asHex(inputs[i]!);
    parsed.push(
      fillKnownCommand(emptyCommand(i, command, kind, input), signature, depth)
    );
  }
  return parsed;
}

/**
 * True when `recipient` is a real counterparty rather than the router's
 * `MSG_SENDER` / `ADDRESS_THIS` sentinels (or the zero address).
 */
export function isExternalRecipient(address: string | null | undefined): boolean {
  if (!address) return false;
  const key = asAddress(address);
  return (
    key !== '0x0000000000000000000000000000000000000000' &&
    key !== UNIVERSAL_ROUTER_MSG_SENDER &&
    key !== UNIVERSAL_ROUTER_ADDRESS_THIS
  );
}

/** True when the command installs a Permit2 allowance. */
export function isPermit2GrantCommand(
  kind: UniversalRouterCommandKind
): boolean {
  return kind === 'permit2_permit' || kind === 'permit2_permit_batch';
}

/**
 * Decode Uniswap Universal Router `execute` calldata, or null when the
 * selector is not a known execute ABI. Throws when the selector matches
 * but the arguments are malformed, or when command/input counts differ.
 */
export function decodeUniversalRouter(
  data: string
): UniversalRouterDecoded | null {
  if (!isHexString(data)) {
    throw new Error('Invalid hex data');
  }
  const hex = stripHexPrefix(data).toLowerCase();
  if (hex.length < 8) return null;
  const variant = SELECTOR_VARIANT[hex.slice(0, 8)];
  if (!variant) return null;

  const signature = UNIVERSAL_ROUTER_SIGNATURES[variant];
  let args: readonly unknown[];
  try {
    const decoded = decodeFunctionData({
      abi: EXECUTE_ABI,
      data: `0x${hex}` as Hex,
    });
    args = (decoded.args ?? []) as readonly unknown[];
  } catch {
    throw new Error(`Malformed arguments for ${signature}`);
  }

  const commands = args[0] as string;
  const inputs = args[1] as readonly string[];
  const deadline = variant === 'execute_deadline' ? (args[2] as bigint) : null;

  return {
    method: 'universal_router',
    variant,
    signature,
    deadline,
    commands: parseCommandList(commands, inputs, signature, 1),
  };
}
