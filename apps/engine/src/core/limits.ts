import { abs } from '@euroedge/fixed';
import type { EngineOutput } from './outputs.ts';
import { decide, outcomeOutput, type OrderRequest } from './orders.ts';
import type {
  EngineState,
  OrderOutcome,
  RejectReason,
  RestingOrder,
  StopTrigger,
} from './state.ts';

/** Anti-spam bound on resting orders per account. */
export const MAX_RESTING_PER_ACCOUNT = 50;

const reject = (reason: RejectReason): OrderOutcome => ({ status: 'rejected', reason });

export interface RestingRequest extends Omit<OrderRequest, 'qty' | 'limitPrice' | 'maker'> {
  readonly qty: bigint;
  readonly limitPrice: bigint | null;
  readonly stop: { readonly price: bigint; readonly kind: 'stop' | 'take-profit' } | null;
  readonly ocoGroup: string | null;
}

/**
 * A stop fires when the mark moves against the order's side (a buy stop on a rise, a sell
 * stop on a fall); a take-profit fires on the opposite move (M4-07).
 */
export function stopTrigger(qty: bigint, stop: NonNullable<RestingRequest['stop']>): StopTrigger {
  const buy = qty > 0n;
  return { price: stop.price, triggersOn: buy === (stop.kind === 'stop') ? 'rise' : 'fall' };
}

const fired = (t: StopTrigger, mark: bigint): boolean =>
  t.triggersOn === 'rise' ? mark >= t.price : mark <= t.price;

/** Checks a conditional order can rest: market data, account, reduce-only, not already fired. */
function stopRejection(
  state: EngineState,
  o: RestingRequest,
  t: StopTrigger,
): RejectReason | undefined {
  if (!state.genesis) return 'not-genesis';
  const m = state.markets.get(o.market);
  if (m === undefined) return 'unknown-market';
  if (m.data === undefined) return 'no-market-data';
  const acc = state.accounts.get(o.account);
  if (acc === undefined) return 'unknown-account';
  if (o.reduceOnly) {
    const lots = acc.positions.get(o.market)?.lots ?? 0n;
    const reduces = lots !== 0n && lots > 0n !== o.qty > 0n && abs(o.qty) <= abs(lots);
    if (!reduces) return 'reduce-only';
  }
  return fired(t, m.data.mark) ? 'would-trigger' : undefined;
}

/**
 * Resting orders (M4-06/07). A limit order fills at once as a taker if the house quote is at or
 * better than its limit; otherwise it rests and fills later as a maker. A stop / take-profit
 * rests until the mark reaches its trigger, then executes as a taker (market, or limit for a
 * stop-limit; a stop-limit that does not cross then rests as a plain limit). Full fills only, GTC.
 */
export function placeRestingOrder(state: EngineState, o: RestingRequest): EngineOutput[] {
  const key = `${o.account}:${o.idempotencyKey}`;
  const seen = state.idempotency.get(key);
  if (seen !== undefined) return [outcomeOutput(o, seen, true)];
  let outcome: OrderOutcome;
  let stop: StopTrigger | null = null;
  if ((o.limitPrice !== null && o.limitPrice <= 0n) || (o.stop !== null && o.stop.price <= 0n)) {
    outcome = reject('invalid-price');
  } else if (o.stop !== null) {
    stop = stopTrigger(o.qty, o.stop);
    const why = stopRejection(state, o, stop);
    outcome = why === undefined ? reject('not-marketable') : reject(why);
  } else if (o.limitPrice !== null) {
    outcome = decide(state, { ...o, limitPrice: o.limitPrice, maker: false });
  } else {
    outcome = reject('invalid-price');
  }
  if (outcome.status === 'rejected' && outcome.reason === 'not-marketable') {
    const open = [...state.orders.values()].filter((x) => x.account === o.account).length;
    if (open >= MAX_RESTING_PER_ACCOUNT) outcome = reject('too-many-orders');
    else {
      state.orders.set(key, {
        orderId: o.idempotencyKey,
        requestId: o.requestId,
        account: o.account,
        market: o.market,
        qty: o.qty,
        limitPrice: o.limitPrice,
        reduceOnly: o.reduceOnly,
        stop,
        ocoGroup: o.ocoGroup,
      });
      outcome = { status: 'accepted', orderId: o.idempotencyKey };
    }
  }
  state.idempotency.set(key, outcome);
  const out = [outcomeOutput(o, outcome, false)];
  if (outcome.status !== 'rejected') out.push({ type: 'AccountChanged', account: o.account });
  return out;
}

/**
 * Reasons a resting order waits instead of being cancelled: not marketable yet, or a
 * circuit breaker blocking new exposure for now (brief §6.5). Breakers are temporary, so
 * the order survives and can fill once the breaker clears.
 */
const KEEP_RESTING: ReadonlySet<RejectReason> = new Set(['not-marketable', 'circuit-breaker']);

const cancelled = (r: RestingOrder, reason: RejectReason | 'oco'): EngineOutput[] => [
  {
    type: 'OrderCancelled',
    requestId: r.requestId,
    account: r.account,
    orderId: r.orderId,
    reason,
  },
  { type: 'AccountChanged', account: r.account },
];

/**
 * Evaluates the resting orders of one market against the current mark and quote, oldest
 * first: fires stops whose trigger the mark has reached, fills what crosses, and cancels the
 * rest of an OCO group once one of its orders fills.
 */
export function matchResting(state: EngineState, market: string): EngineOutput[] {
  const mark = state.markets.get(market)?.data?.mark;
  if (mark === undefined) return [];
  const out: EngineOutput[] = [];
  for (const [key, r] of state.orders) {
    if (r.market !== market) continue;
    const firing = r.stop !== null;
    if (r.stop !== null && !fired(r.stop, mark)) continue;
    const outcome = decide(state, {
      requestId: r.requestId,
      idempotencyKey: r.orderId,
      account: r.account,
      market: r.market,
      qty: r.qty,
      reduceOnly: r.reduceOnly,
      ...(r.limitPrice === null ? {} : { limitPrice: r.limitPrice }),
      // A plain resting order provides liquidity; a stop firing now takes it.
      maker: !firing,
    });
    if (outcome.status === 'rejected' && KEEP_RESTING.has(outcome.reason)) {
      // A fired stop-limit that does not cross rests on as a plain limit (keeps its time slot).
      if (firing && outcome.reason === 'not-marketable')
        state.orders.set(key, { ...r, stop: null });
      continue;
    }
    state.orders.delete(key);
    if (outcome.status !== 'filled') {
      out.push(...cancelled(r, outcome.status === 'rejected' ? outcome.reason : 'unknown-order'));
      continue;
    }
    out.push(
      {
        type: 'OrderFilled',
        requestId: r.requestId,
        account: r.account,
        fill: outcome.fill,
        duplicate: false,
      },
      { type: 'AccountChanged', account: r.account },
    );
    if (r.ocoGroup === null) continue;
    for (const [k, s] of state.orders) {
      if (s.account === r.account && s.ocoGroup === r.ocoGroup) {
        state.orders.delete(k);
        out.push(...cancelled(s, 'oco'));
      }
    }
  }
  return out;
}

export function cancelOrder(
  state: EngineState,
  c: { readonly requestId: string; readonly account: string; readonly orderId: string },
): EngineOutput[] {
  const key = `${c.account}:${c.orderId}`;
  const r = state.orders.get(key);
  if (r === undefined)
    return [
      {
        type: 'OrderRejected',
        requestId: c.requestId,
        account: c.account,
        reason: 'unknown-order',
        duplicate: false,
      },
    ];
  state.orders.delete(key);
  return [
    {
      type: 'OrderCancelled',
      requestId: c.requestId,
      account: c.account,
      orderId: c.orderId,
      reason: 'user',
    },
    { type: 'AccountChanged', account: c.account },
  ];
}
