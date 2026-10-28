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

/**
 * Unrealized PnL of a position at the market's mark, µUSDC (0 without data).
 * Not short-circuited on zero lots: the house mirror can be flat in lots yet carry a cost
 * basis (users long and short at different prices) — that value is real house equity.
 */
export function positionUpnl(m: MarketState, pos: Position): bigint {
  if (m.data === undefined) return 0n;
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
 * Max leverage now: the window cap, stepped down by any earnings window covering `ts` (M4-08).
 * 0 = reduce-only. Requires market data.
 */
export function effectiveLeverage(m: MarketState, ts: bigint): bigint {
  let lev = m.data === undefined ? 0n : m.windows[m.data.window].maxLeverage;
  for (const e of m.earnings.values())
    if (ts >= e.startTs && ts < e.endTs && e.maxLeverage < lev) lev = e.maxLeverage;
  return lev;
}

/** Gross user open interest in a market at mark, µUSDC, with `account` at `lots` instead. */
export function grossOpenInterest(
  state: EngineState,
  m: MarketState,
  account: AccountId,
  lots: bigint,
): bigint {
  if (m.data === undefined) return 0n;
  let total = 0n;
  for (const acc of state.accounts.values()) {
    const l = acc.id === account ? lots : (acc.positions.get(m.id)?.lots ?? 0n);
    total += l < 0n ? -l : l;
  }
  return total * m.data.mark * m.units.tickValue;
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
    const lev = effectiveLeverage(m, state.ts);
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
