import { isAddressHexLike } from './evm/address';
import {
  decodeErc20DecreaseAllowance,
  decodeErc20IncreaseAllowance,
} from './evm/allowance';
import { decodeErc20Approve } from './evm/approval';
import { decodeErc721SetApprovalForAll } from './evm/erc721';
import { MAX_UINT256, stripHexPrefix } from './evm/hex';
import { decodeErc20Transfer } from './evm/transfer';

/** Placeholder owner/sender when {@link SimOptions.from} is omitted. */
export const CALLER_ACCOUNT = 'caller';

export type SimOptions = {
  /** Transaction sender / token holder. Defaults to {@link CALLER_ACCOUNT}. */
  from?: string;
  /** Prior ERC-20 allowance for (from, spender), when known. */
  currentAllowance?: bigint;
};

export type BalanceDelta = {
  account: string;
  /** Signed decimal string of the token-balance change. */
  delta: string;
};

export type AllowanceDelta = {
  owner: string;
  spender: string;
  mode: 'set' | 'increase' | 'decrease';
  /** Signed decimal change when it can be computed; otherwise null. */
  delta: string | null;
  /** Resulting allowance when it can be computed; otherwise null. */
  newValue: string | null;
  wouldRevert: boolean;
};

export type OperatorDelta = {
  operator: string;
  approved: boolean;
};

export type SimulationSnapshot = {
  balances: BalanceDelta[];
  allowances: AllowanceDelta[];
  operators: OperatorDelta[];
  notes: string[];
};

export function emptySimulation(): SimulationSnapshot {
  return { balances: [], allowances: [], operators: [], notes: [] };
}

function assertUint256(name: string, value: bigint): void {
  if (value < 0n || value > MAX_UINT256) {
    throw new Error(`${name} must be a uint256`);
  }
}

function normalizeFrom(from?: string): string {
  if (from == null || from === '') return CALLER_ACCOUNT;
  if (!isAddressHexLike(from)) {
    throw new Error('Invalid from address');
  }
  return `0x${stripHexPrefix(from).toLowerCase()}`;
}

function snapshot(
  partial: Partial<SimulationSnapshot>
): SimulationSnapshot {
  return {
    balances: partial.balances ?? [],
    allowances: partial.allowances ?? [],
    operators: partial.operators ?? [],
    notes: partial.notes ?? [],
  };
}

/**
 * Offline stub of the token-balance and allowance effects implied by
 * decoded calldata. Does not talk to a node and does not check whether
 * the sender actually holds enough tokens.
 *
 * Returns null when no current decoder matches.
 */
export function simulateCalldata(
  data: string,
  options?: SimOptions
): SimulationSnapshot | null {
  const owner = normalizeFrom(options?.from);
  if (options?.currentAllowance != null) {
    assertUint256('currentAllowance', options.currentAllowance);
  }
  const current = options?.currentAllowance;

  const approve = decodeErc20Approve(data);
  if (approve) {
    const amount = approve.amount;
    const delta = current != null ? amount - current : null;
    return snapshot({
      allowances: [
        {
          owner,
          spender: approve.spender,
          mode: 'set',
          delta: delta != null ? delta.toString() : null,
          newValue: amount.toString(),
          wouldRevert: false,
        },
      ],
    });
  }

  const transfer = decodeErc20Transfer(data);
  if (transfer) {
    const amount = transfer.amount;
    return snapshot({
      balances: [
        { account: owner, delta: (-amount).toString() },
        { account: transfer.to, delta: amount.toString() },
      ],
    });
  }

  const inc = decodeErc20IncreaseAllowance(data);
  if (inc) {
    const added = inc.amountDelta;
    let wouldRevert = false;
    let newValue: string | null = null;
    if (current != null) {
      const next = current + added;
      if (next > MAX_UINT256) {
        wouldRevert = true;
      } else {
        newValue = next.toString();
      }
    }
    return snapshot({
      allowances: [
        {
          owner,
          spender: inc.spender,
          mode: 'increase',
          delta: added.toString(),
          newValue,
          wouldRevert,
        },
      ],
      notes: wouldRevert
        ? [
            'increaseAllowance would revert because the new allowance exceeds uint256.',
          ]
        : [],
    });
  }

  const dec = decodeErc20DecreaseAllowance(data);
  if (dec) {
    const subtracted = dec.amountDelta;
    let wouldRevert = false;
    let newValue: string | null = null;
    if (current != null) {
      if (current < subtracted) {
        wouldRevert = true;
      } else {
        newValue = (current - subtracted).toString();
      }
    }
    return snapshot({
      allowances: [
        {
          owner,
          spender: dec.spender,
          mode: 'decrease',
          delta: (-subtracted).toString(),
          newValue,
          wouldRevert,
        },
      ],
      notes: wouldRevert
        ? [
            'decreaseAllowance would revert because the current allowance is smaller than the subtracted amount.',
          ]
        : [],
    });
  }

  const nft = decodeErc721SetApprovalForAll(data);
  if (nft) {
    return snapshot({
      operators: [{ operator: nft.operator, approved: nft.approved }],
    });
  }

  return null;
}
