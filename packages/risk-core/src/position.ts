import { abs, divRound, sign } from '@euroedge/fixed';
import type { Lots, Ticks } from '@euroedge/fixed';

/**
 * A position in one market: signed size and cost basis in ticks·lots (Σ price × qty of the
 * open part). PnL in µUSDC = ticks·lots × tickValue (exact, ADR-0002).
 */
export interface Position {
  readonly lots: bigint;
  readonly cost: bigint;
}

export const FLAT: Position = { lots: 0n, cost: 0n };

export interface FillResult {
  readonly position: Position;
  /** Realized PnL of the closed part, ticks·lots. */
  readonly realized: bigint;
  /** Lots closed (≥ 0). */
  readonly closed: bigint;
}

/**
 * Applies a fill of signed `qty` lots at `price`. Reducing removes cost pro rata, truncated
 * toward zero; the truncation stays in the remaining cost, so the cost basis is conserved and
 * a position that ends flat has realized exactly −Σ price·qty over its fills. A fill larger
 * than the position flips it at `price`.
 */
export function applyFill(pos: Position, qty: Lots | bigint, price: Ticks): FillResult {
  if (qty === 0n) return { position: pos, realized: 0n, closed: 0n };
  if (pos.lots === 0n || sign(pos.lots) === sign(qty)) {
    return {
      position: { lots: pos.lots + qty, cost: pos.cost + price * qty },
      realized: 0n,
      closed: 0n,
    };
  }
  const closedAbs = abs(qty) < abs(pos.lots) ? abs(qty) : abs(pos.lots);
  // Part of the position being closed, with the position's own sign.
  const closedSigned = sign(pos.lots) * closedAbs;
  const removedCost =
    closedAbs === abs(pos.lots) ? pos.cost : divRound(pos.cost * closedSigned, pos.lots, 'trunc');
  const realized = price * closedSigned - removedCost;
  let lots = pos.lots - closedSigned;
  let cost = pos.cost - removedCost;
  const remainder = qty + closedSigned; // what is left after closing, same sign as qty
  if (remainder !== 0n) {
    lots += remainder;
    cost += price * remainder;
  }
  return { position: { lots, cost }, realized, closed: closedAbs };
}

/** Unrealized PnL at `mark`, ticks·lots. */
export const unrealized = (pos: Position, mark: Ticks): bigint => mark * pos.lots - pos.cost;

/** Average entry price in ticks (display only; rounded toward the trader's disadvantage). */
export function averageEntry(pos: Position): bigint | undefined {
  if (pos.lots === 0n) return undefined;
  return divRound(pos.cost, pos.lots, pos.lots > 0n ? 'ceil' : 'floor');
}
