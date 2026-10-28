import type { EngineOutput } from './outputs.ts';
import { decide, outcomeOutput, type OrderRequest } from './orders.ts';
import type { EngineState, OrderOutcome, RejectReason } from './state.ts';

/** Anti-spam bound on resting orders per account. */
export const MAX_RESTING_PER_ACCOUNT = 50;

const reject = (reason: RejectReason): OrderOutcome => ({ status: 'rejected', reason });

/**
 * Limit order (M4): fills at once as a taker if the house quote is at or better than the limit;
 * otherwise it rests and is matched on later market data as a maker (full fills only, GTC).
 */
export function placeLimitOrder(
  state: EngineState,
  o: OrderRequest & { readonly limitPrice: bigint; readonly qty: bigint },
): EngineOutput[] {
  const key = `${o.account}:${o.idempotencyKey}`;
  const seen = state.idempotency.get(key);
  if (seen !== undefined) return [outcomeOutput(o, seen, true)];
  let outcome =
    o.limitPrice <= 0n ? reject('invalid-price') : decide(state, { ...o, maker: false });
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
      });
      outcome = { status: 'accepted', orderId: o.idempotencyKey };
    }
  }
  state.idempotency.set(key, outcome);
  const out = [outcomeOutput(o, outcome, false)];
  if (outcome.status !== 'rejected') out.push({ type: 'AccountChanged', account: o.account });
  return out;
}

/** Matches resting orders of one market against the current quote, oldest first. */
export function matchResting(state: EngineState, market: string): EngineOutput[] {
  const out: EngineOutput[] = [];
  for (const [key, r] of state.orders) {
    if (r.market !== market) continue;
    const outcome = decide(state, {
      requestId: r.requestId,
      idempotencyKey: r.orderId,
      account: r.account,
      market: r.market,
      qty: r.qty,
      reduceOnly: r.reduceOnly,
      limitPrice: r.limitPrice,
      maker: true,
    });
    if (outcome.status === 'rejected' && outcome.reason === 'not-marketable') continue;
    state.orders.delete(key);
    out.push(
      outcome.status === 'filled'
        ? {
            type: 'OrderFilled',
            requestId: r.requestId,
            account: r.account,
            fill: outcome.fill,
            duplicate: false,
          }
        : {
            type: 'OrderCancelled',
            requestId: r.requestId,
            account: r.account,
            orderId: r.orderId,
            reason: outcome.status === 'rejected' ? outcome.reason : 'user',
          },
      { type: 'AccountChanged', account: r.account },
    );
  }
  return out;
}

export function cancelOrder(
  state: EngineState,
  c: { readonly requestId: string; readonly account: string; readonly orderId: string },
): EngineOutput[] {
  const key = `${c.account}:${c.orderId}`;
  if (!state.orders.has(key))
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
