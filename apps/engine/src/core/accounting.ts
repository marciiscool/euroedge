import { usdc, type Usdc } from '@euroedge/fixed';
import { SYSTEM, userAccount } from '@euroedge/ledger';
import {
  initialMargin,
  maintenanceMargin,
  notionalUsdc,
  unrealized,
  type Position,
} from '@euroedge/risk-core';
import type { AccountId, MarketId } from './events.ts';
import type { EngineState, MarketState } from './state.ts';

/** Unrealized PnL of a position at the market's mark, µUSDC (0 without data). */
export function positionUpnl(m: MarketState, pos: Position): bigint {
  if (m.data === undefined || pos.lots === 0n) return 0n;
  return unrealized(pos, m.data.mark) * m.units.tickValue;
}

function marketOf(state: EngineState, id: MarketId): MarketState {
  const m = state.markets.get(id);
  if (m === undefined) throw new Error(`position in unknown market ${id}`);
  return m;
}

/** Account equity = cash + Σ uPnL at mark, µUSDC. */
export function accountEquity(
  state: EngineState,
  account: AccountId,
  override?: ReadonlyMap<MarketId, Position>,
): Usdc {
  let equity = state.ledger.balance(userAccount(account)) as bigint;
  const acc = state.accounts.get(account);
  const ids = new Set([...(acc?.positions.keys() ?? []), ...(override?.keys() ?? [])]);
  for (const id of ids) {
    const pos = override?.get(id) ?? acc?.positions.get(id);
    if (pos !== undefined) equity += positionUpnl(marketOf(state, id), pos);
  }
  return usdc(equity);
}

/** Σ maintenance margin over the account's positions at mark. */
export function accountMaintenance(state: EngineState, account: AccountId): Usdc {
  let mm = 0n;
  for (const [id, pos] of state.accounts.get(account)?.positions ?? []) {
    const m = marketOf(state, id);
    if (pos.lots !== 0n && m.data !== undefined) {
      mm += maintenanceMargin(
        notionalUsdc(pos.lots, m.data.mark, m.units.tickValue),
        m.maintenanceMarginBps,
      );
    }
  }
  return usdc(mm);
}

/**
 * Σ initial margin at mark under each market's current window cap, for a hypothetical set
 * of positions. Returns undefined if any non-flat position sits in a reduce-only window.
 */
export function initialRequirement(
  state: EngineState,
  positions: ReadonlyMap<MarketId, Position>,
): Usdc | undefined {
  let im = 0n;
  for (const [id, pos] of positions) {
    if (pos.lots === 0n) continue;
    const m = marketOf(state, id);
    if (m.data === undefined) return undefined;
    const lev = m.windows[m.data.window].maxLeverage;
    if (lev === 0n) return undefined;
    im += initialMargin(notionalUsdc(pos.lots, m.data.mark, m.units.tickValue), lev);
  }
  return usdc(im);
}

/** House equity = house cash + Σ house uPnL at mark (ADR-0013, founder-confirmed). */
export function houseEquity(state: EngineState): Usdc {
  let e = state.ledger.balance(SYSTEM.house) as bigint;
  for (const m of state.markets.values()) e += positionUpnl(m, m.house);
  return usdc(e);
}
