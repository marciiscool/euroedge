import { abs, bps, feeBps, usdc } from '@euroedge/fixed';
import { SYSTEM, userAccount, type Posting } from '@euroedge/ledger';
import {
  applyFill,
  FLAT,
  houseQuote,
  notionalUsdc,
  withinPriceLimit,
  type Position,
} from '@euroedge/risk-core';
import { accountEquity, initialRequirement } from './accounting.ts';
import type { AccountId, MarketId, Side } from './events.ts';
import type { EngineOutput } from './outputs.ts';
import type { EngineState, OrderOutcome, RejectReason } from './state.ts';

export interface OrderRequest {
  readonly requestId: string;
  readonly idempotencyKey: string;
  readonly account: AccountId;
  readonly market: MarketId;
  /** Signed lots (+ buy, − sell); undefined = close the whole position. */
  readonly qty: bigint | undefined;
  readonly reduceOnly: boolean;
  /** Fill only at this price or better (ticks). */
  readonly limitPrice?: bigint;
  /** A resting order filling later pays the maker fee. */
  readonly maker?: boolean;
}

/** Market order against the house quote (M1: market and close orders only). */
export function executeOrder(state: EngineState, o: OrderRequest): EngineOutput[] {
  const key = `${o.account}:${o.idempotencyKey}`;
  const seen = state.idempotency.get(key);
  if (seen !== undefined) return [outcomeOutput(o, seen, true)];
  const outcome = decide(state, o);
  state.idempotency.set(key, outcome);
  const out = [outcomeOutput(o, outcome, false)];
  if (outcome.status === 'filled') out.push({ type: 'AccountChanged', account: o.account });
  return out;
}

export function outcomeOutput(
  o: Pick<OrderRequest, 'requestId' | 'account'>,
  outcome: OrderOutcome,
  duplicate: boolean,
): EngineOutput {
  if (outcome.status === 'accepted')
    return {
      type: 'OrderAccepted',
      requestId: o.requestId,
      account: o.account,
      orderId: outcome.orderId,
      duplicate,
    };
  return outcome.status === 'filled'
    ? {
        type: 'OrderFilled',
        requestId: o.requestId,
        account: o.account,
        fill: outcome.fill,
        duplicate,
      }
    : {
        type: 'OrderRejected',
        requestId: o.requestId,
        account: o.account,
        reason: outcome.reason,
        duplicate,
      };
}

const reject = (reason: RejectReason): OrderOutcome => ({ status: 'rejected', reason });

/** All checks and, if they pass, the fill. Nothing is mutated unless the outcome is 'filled'. */
export function decide(state: EngineState, o: OrderRequest): OrderOutcome {
  if (!state.genesis) return reject('not-genesis');
  const m = state.markets.get(o.market);
  if (m === undefined) return reject('unknown-market');
  const data = m.data;
  if (data === undefined) return reject('no-market-data');
  const acc = state.accounts.get(o.account);
  if (acc === undefined) return reject('unknown-account');

  const pos = acc.positions.get(o.market) ?? FLAT;
  const closing = o.qty === undefined;
  const qty = closing ? -pos.lots : o.qty;
  if (qty === 0n) return reject('no-position');
  const reduces = pos.lots !== 0n && pos.lots > 0n !== qty > 0n && abs(qty) <= abs(pos.lots);
  if ((o.reduceOnly || closing) && !reduces) return reject('reduce-only');

  // Circuit breakers (brief §6.5): every non-none effect, and CB7 globally, blocks new exposure.
  if (!reduces && (data.breaker !== 'none' || state.capitalFloor)) return reject('circuit-breaker');
  const risk = m.windows[data.window];
  // Degraded markets quote twice the usual half-spread.
  const halfSpread =
    data.breaker === 'degraded' ? risk.houseHalfSpreadBps * 2n : risk.houseHalfSpreadBps;
  const quote = houseQuote(data.fv, halfSpread);
  const side: Side = qty > 0n ? 'buy' : 'sell';
  const price = side === 'buy' ? quote.ask : quote.bid;
  if (o.limitPrice !== undefined && (side === 'buy' ? price > o.limitPrice : price < o.limitPrice))
    return reject('not-marketable');
  if (!withinPriceLimit(price, data.index, risk.priceLimitBps)) return reject('price-limit');

  const notional = notionalUsdc(qty, price, m.units.tickValue);
  if (!reduces && notional < m.minNotional) return reject('min-notional');
  const fee = feeBps(notional, bps(o.maker === true ? risk.makerFeeBps : risk.takerFeeBps));
  const r = applyFill(pos, qty, price);
  const realized = r.realized * m.units.tickValue;

  if (!reduces) {
    if (risk.maxLeverage === 0n) return reject('reduce-only-window');
    const after = new Map<MarketId, Position>(acc.positions);
    after.set(o.market, r.position);
    const im = initialRequirement(state, after);
    if (im === undefined) return reject('reduce-only-window');
    // Equity after the trade: cash − fee + realized + uPnL of the new positions at mark.
    const equityAfter = accountEquity(state, o.account, after) - fee + realized;
    if (equityAfter < im) return reject('insufficient-margin');
  }

  // Apply: user position, mirrored house position, cash postings.
  const deltaCost = r.position.cost - pos.cost;
  acc.positions.set(o.market, r.position);
  m.house = { lots: m.house.lots - qty, cost: m.house.cost - deltaCost };
  const postings: Posting[] = [];
  const user = userAccount(o.account);
  if (fee > 0n) postings.push({ from: user, to: SYSTEM.fees, amount: fee, reason: 'fee' });
  if (realized > 0n)
    postings.push({ from: SYSTEM.house, to: user, amount: usdc(realized), reason: 'realized-pnl' });
  if (realized < 0n)
    postings.push({
      from: user,
      to: SYSTEM.house,
      amount: usdc(-realized),
      reason: 'realized-pnl',
    });
  state.ledger.post(postings);
  return {
    status: 'filled',
    fill: { market: o.market, side, qty: abs(qty), price, fee, realized: usdc(realized) },
  };
}
