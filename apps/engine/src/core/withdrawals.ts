import { usdc, type Usdc } from '@euroedge/fixed';
import { SYSTEM, userAccount } from '@euroedge/ledger';
import { accountEquity, initialRequirement } from './accounting.ts';
import type { AccountId } from './events.ts';
import type { EngineOutput } from './outputs.ts';
import type { EngineState, Withdrawal } from './state.ts';

/**
 * How long an engine-signed withdrawal authorisation stays valid on-chain (EIP-712
 * `deadline`). PROPOSED value (founder review, M4-18): 1 hour.
 */
export const WITHDRAWAL_TTL_MS = 3_600_000n;

/** Withdrawals go to the account's own address, so only wallet accounts can withdraw. */
const WALLET = /^0x[0-9a-f]{40}$/;

export type WithdrawalRejectReason =
  | 'not-genesis'
  | 'invalid-amount'
  | 'not-a-wallet'
  | 'unknown-account'
  | 'insufficient-withdrawable';

/**
 * Free collateral: what can leave without the account falling below initial margin at the
 * current window caps, and never more than its cash. A position in a market without data
 * or in a reduce-only window locks the account (nothing withdrawable) until that clears.
 */
export function withdrawable(state: EngineState, account: AccountId): Usdc {
  const acc = state.accounts.get(account);
  if (acc === undefined) return usdc(0n);
  const cash = state.ledger.balance(userAccount(account)) as bigint;
  const im = initialRequirement(state, acc.positions);
  if (im === undefined) return usdc(0n);
  const free = (accountEquity(state, account) as bigint) - (im as bigint);
  const w = free < cash ? free : cash;
  return usdc(w > 0n ? w : 0n);
}

/**
 * Reserves an amount for an on-chain withdrawal (user → vault-pending) and assigns the
 * nonce and deadline the engine signer puts into the EIP-712 authorisation (M5-04).
 * Idempotent per (account, requestId) for successful reservations.
 */
export function requestWithdrawal(
  state: EngineState,
  input: { readonly requestId: string; readonly account: AccountId; readonly amount: Usdc },
): EngineOutput[] {
  const { requestId, account, amount } = input;
  const id = `${account}:${requestId}`;
  const seen = state.withdrawals.get(id);
  if (seen !== undefined) return [reserved(requestId, seen, true)];
  const reject = (reason: WithdrawalRejectReason): EngineOutput[] => [
    { type: 'WithdrawalRejected', requestId, account, reason },
  ];
  if (!state.genesis) return reject('not-genesis');
  if (amount <= 0n) return reject('invalid-amount');
  if (!WALLET.test(account)) return reject('not-a-wallet');
  if (!state.accounts.has(account)) return reject('unknown-account');
  if (amount > withdrawable(state, account)) return reject('insufficient-withdrawable');

  state.ledger.post([
    { from: userAccount(account), to: SYSTEM.vaultPending, amount, reason: 'withdrawal' },
  ]);
  const w: Withdrawal = {
    id,
    account,
    amount,
    nonce: state.withdrawalNonce,
    deadline: state.ts + WITHDRAWAL_TTL_MS,
    status: 'pending',
  };
  state.withdrawalNonce += 1n;
  state.withdrawals.set(id, w);
  return [reserved(requestId, w, false), { type: 'AccountChanged', account }];
}

/**
 * The indexer saw the outcome on-chain (safe tag): `executed` leaves the system
 * (vault-pending → external), `expired` (deadline passed, nonce unused) is re-credited.
 */
export function settleWithdrawal(
  state: EngineState,
  withdrawalId: string,
  outcome: 'executed' | 'expired',
): EngineOutput[] {
  const w = state.withdrawals.get(withdrawalId);
  const ignore = (reason: string): EngineOutput[] => [
    {
      type: 'InputIgnored',
      input: outcome === 'executed' ? 'WithdrawalExecuted' : 'WithdrawalExpired',
      reason,
    },
  ];
  if (w === undefined) return ignore('unknown withdrawal');
  if (w.status !== 'pending') return ignore(`withdrawal already ${w.status}`);
  if (outcome === 'expired' && state.ts <= w.deadline) return ignore('deadline not passed');

  if (outcome === 'executed') {
    state.ledger.post([
      { from: SYSTEM.vaultPending, to: SYSTEM.external, amount: w.amount, reason: 'withdrawal' },
    ]);
    state.netDeposits -= w.amount;
  } else {
    state.ledger.post([
      {
        from: SYSTEM.vaultPending,
        to: userAccount(w.account),
        amount: w.amount,
        reason: 'withdrawal',
      },
    ]);
  }
  state.withdrawals.set(withdrawalId, { ...w, status: outcome });
  return [
    { type: 'WithdrawalSettled', withdrawalId, account: w.account, amount: w.amount, outcome },
    { type: 'AccountChanged', account: w.account },
  ];
}

/** Σ amounts of pending withdrawals (equals the vault-pending balance, Invariant 10). */
export function pendingWithdrawals(state: EngineState): bigint {
  let sum = 0n;
  for (const w of state.withdrawals.values()) if (w.status === 'pending') sum += w.amount;
  return sum;
}

const reserved = (requestId: string, w: Withdrawal, duplicate: boolean): EngineOutput => ({
  type: 'WithdrawalReserved',
  requestId,
  withdrawalId: w.id,
  account: w.account,
  amount: w.amount,
  nonce: w.nonce,
  deadline: w.deadline,
  duplicate,
});
