import { abs } from '@euroedge/fixed';
import { houseEquity } from './accounting.ts';
import type { WindowRisk } from './events.ts';
import type { EngineOutput } from './outputs.ts';
import type { EngineState, MarketState, RejectReason } from './state.ts';

/** House risk limits (ADR-0003 §7, M4-14; values proposed in ADR-0019). */

export const DAY_MS = 86_400_000n;

const allMarketsChanged = (state: EngineState): EngineOutput[] =>
  [...state.markets.keys()].map((market) => ({ type: 'MarketChanged', market }));

/**
 * Starts a new UTC day before the day's first input is applied. Equity then still equals
 * equity at midnight (mark changes only arrive as inputs), so it is the day's reference.
 * A daily-loss halt ends with the day.
 */
export function rollHouseDay(state: EngineState, ts: bigint): EngineOutput[] {
  const r = state.houseRisk;
  const day = ts / DAY_MS;
  if (day === r.day) return [];
  r.day = day;
  r.dayStartEquity = houseEquity(state);
  if (!r.halted) return [];
  r.halted = false;
  return [{ type: 'HouseLossLimitChanged', active: false, loss: 0n }, ...allMarketsChanged(state)];
}

/** After every event: halt new exposure everywhere once today's house loss exceeds the limit. */
export function evaluateHouseLoss(state: EngineState): EngineOutput[] {
  const r = state.houseRisk;
  if (r.halted || r.dailyLossLimit === null || !state.genesis) return [];
  const loss = r.dayStartEquity - (houseEquity(state) as bigint);
  if (loss <= r.dailyLossLimit) return [];
  r.halted = true;
  return [{ type: 'HouseLossLimitChanged', active: true, loss }, ...allMarketsChanged(state)];
}

/** House inventory at FV, µUSDC (> 0 = house long). */
export const houseInventory = (m: MarketState): bigint =>
  m.data === undefined ? 0n : m.house.lots * m.data.fv * m.units.tickValue;

/**
 * Inventory limits for an order that adds user exposure (signed `qty` lots):
 * - past `inventoryHardCap` the market is reduce-only, and no order may take the house past it;
 * - past `inventoryCap` the house quotes one side only: orders that grow its inventory wait.
 */
export function inventoryRejection(
  m: MarketState,
  risk: WindowRisk,
  qty: bigint,
): RejectReason | undefined {
  if (m.data === undefined) return undefined;
  const inv = houseInventory(m);
  const after = (m.house.lots - qty) * m.data.fv * m.units.tickValue;
  const hard = risk.inventoryHardCap;
  if (hard !== null && abs(inv) >= hard) return 'house-inventory';
  if (abs(after) <= abs(inv)) return undefined;
  if (hard !== null && abs(after) > hard) return 'house-inventory';
  if (risk.inventoryCap !== null && abs(inv) >= risk.inventoryCap) return 'house-one-sided';
  return undefined;
}

/** Which user orders the house currently refuses in `m`, for the market snapshot. */
export function inventoryLimit(m: MarketState): 'none' | 'no-buys' | 'no-sells' | 'reduce-only' {
  const d = m.data;
  if (d === undefined) return 'none';
  const risk = m.windows[d.window];
  const inv = houseInventory(m);
  if (risk.inventoryHardCap !== null && abs(inv) >= risk.inventoryHardCap) return 'reduce-only';
  if (risk.inventoryCap === null || abs(inv) < risk.inventoryCap) return 'none';
  // A long house refuses more user selling, a short house more user buying.
  return inv > 0n ? 'no-sells' : 'no-buys';
}
