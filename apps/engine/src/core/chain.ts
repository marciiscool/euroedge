import { SYSTEM, userAccount } from '@euroedge/ledger';
import type { EngineInput } from './events.ts';
import type { EngineOutput } from './outputs.ts';
import type { EngineState } from './state.ts';
import { settleWithdrawal } from './withdrawals.ts';

type Deposit = Extract<EngineInput, { type: 'ChainDeposit' }>;
type Withdrawn = Extract<EngineInput, { type: 'VaultWithdrawn' }>;

/**
 * Chain events from the indexer (M5-09). Each Vault log applies exactly once, keyed by
 * (txHash, logIndex), so the indexer may re-send a range after a restart or a reorg check.
 */
const seen = (state: EngineState, i: { txHash: string; logIndex: number }) => {
  const key = `${i.txHash}:${i.logIndex}`;
  if (state.chainLogs.has(key)) return true;
  state.chainLogs.set(key, state.seq);
  return false;
};

export function chainDeposit(state: EngineState, d: Deposit): EngineOutput[] {
  if (!state.genesis) return [{ type: 'InputIgnored', input: d.type, reason: 'before genesis' }];
  if (seen(state, d))
    return [{ type: 'InputIgnored', input: d.type, reason: 'log already applied' }];
  if (!state.accounts.has(d.account))
    state.accounts.set(d.account, { id: d.account, positions: new Map() });
  state.ledger.post([
    { from: SYSTEM.external, to: userAccount(d.account), amount: d.amount, reason: 'deposit' },
  ]);
  state.netDeposits += d.amount;
  return [
    { type: 'CashFlow', account: d.account, market: '', kind: 'deposit', amount: d.amount },
    { type: 'AccountChanged', account: d.account },
  ];
}

/** Settles the pending withdrawal with this nonce, if account and amount match what was signed. */
export function vaultWithdrawn(state: EngineState, w: Withdrawn): EngineOutput[] {
  const ignore = (reason: string): EngineOutput[] => [
    { type: 'InputIgnored', input: w.type, reason },
  ];
  if (seen(state, w)) return ignore('log already applied');
  for (const x of state.withdrawals.values()) {
    if (x.nonce !== w.nonce) continue;
    // The Vault only pays what the signer authorised; a mismatch means a bug or a key leak.
    if (x.account !== w.account || x.amount !== w.amount)
      return ignore(`withdrawal ${x.id} does not match the chain log (alert)`);
    return settleWithdrawal(state, x.id, 'executed');
  }
  return ignore(`no withdrawal with nonce ${w.nonce} (alert)`);
}
