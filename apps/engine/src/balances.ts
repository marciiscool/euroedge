import { userAccount } from '@euroedge/ledger';
import type { BalanceSnapshot } from '@euroedge/shared';
import type { EngineState } from './core/state.ts';

export const HOUR_MS = 3_600_000n;
const WALLET = /^0x[0-9a-f]{40}$/;

/**
 * Hourly balance snapshot for the Merkle root (M5-12): settled cash (µUSDC) of every wallet
 * account with a positive balance, sorted by account, with the seq it was taken at.
 */
export function balanceSnapshot(state: EngineState, hour: bigint): BalanceSnapshot {
  const leaves: [string, string][] = [];
  for (const id of state.accounts.keys()) {
    if (!WALLET.test(id)) continue;
    const cash = state.ledger.balance(userAccount(id)) as bigint;
    if (cash > 0n) leaves.push([id, cash.toString()]);
  }
  leaves.sort(([a], [b]) => (a < b ? -1 : 1));
  return { hour: hour.toString(), seq: state.seq.toString(), leaves };
}
