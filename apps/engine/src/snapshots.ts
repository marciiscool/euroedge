import { formatDecimal, lots, lotsToQty, ticks, ticksToPrice, usdc } from '@euroedge/fixed';
import { averageEntry, liquidationPrice } from '@euroedge/risk-core';
import type { AccountSnapshot, MarketSnapshot, OrderResult } from '@euroedge/shared';
import {
  accountEquity,
  accountMaintenance,
  effectiveLeverage,
  positionUpnl,
} from './core/accounting.ts';
import type { EngineOutput } from './core/outputs.ts';
import { inventoryLimit } from './core/house-risk.ts';
import { marketQuote } from './core/quote.ts';
import type { EngineState } from './core/state.ts';

const usdcStr = (v: bigint) => formatDecimal(v, 6);

/** Public market view (decimal strings) — read side, outside the deterministic core. */
export function marketSnapshot(state: EngineState, id: string): MarketSnapshot | undefined {
  const m = state.markets.get(id);
  const d = m?.data;
  if (m === undefined || d === undefined) return undefined;
  const risk = m.windows[d.window];
  const q = marketQuote(m, state.ts);
  if (q === undefined) return undefined;
  const px = (t: bigint) => ticksToPrice(m.units, ticks(t));
  return {
    market: id,
    seq: state.seq.toString(),
    ts: Number(d.ts),
    window: d.window,
    fv: px(d.fv),
    bandLo: px(d.bandLo),
    bandHi: px(d.bandHi),
    index: px(d.index),
    mark: px(d.mark),
    bid: px(q.bid),
    ask: px(q.ask),
    sigmaBp: Number(d.sigmaPpm) / 100,
    // Effective: the window cap, stepped down during an earnings window (M4-08).
    maxLeverage: Number(effectiveLeverage(m, state.ts)),
    takerFeeBps: Number(risk.takerFeeBps),
    tickSize: m.units.tickSize,
    lotSize: m.units.lotSize,
    minNotional: usdcStr(m.minNotional),
    capitalFloor: state.capitalFloor,
    houseLossLimit: state.houseRisk.halted,
    inventoryLimit: inventoryLimit(m),
    ladder: q.ladder.map((r) => ({
      notional: usdcStr(r.notional),
      bid: px(r.bid),
      ask: px(r.ask),
    })),
  };
}

export function accountSnapshot(state: EngineState, account: string): AccountSnapshot {
  const acc = state.accounts.get(account);
  const cash = state.ledger.balance(`user:${account}`);
  const positions = [...(acc?.positions ?? [])]
    .filter(([, p]) => p.lots !== 0n)
    .map(([id, p]) => {
      const m = state.markets.get(id);
      if (m === undefined) throw new Error(`unknown market ${id}`);
      const entry = averageEntry(p);
      const liq = liquidationPrice(cash, p.lots, p.cost, m.units.tickValue, m.maintenanceMarginBps);
      return {
        market: id,
        size: lotsToQty(m.units, lots(p.lots)),
        entry: entry === undefined ? null : ticksToPrice(m.units, ticks(entry)),
        mark: m.data === undefined ? null : ticksToPrice(m.units, m.data.mark),
        upnl: usdcStr(positionUpnl(m, p)),
        liquidationPrice: liq === undefined ? null : ticksToPrice(m.units, ticks(liq)),
      };
    });
  return {
    account,
    seq: state.seq.toString(),
    cash: usdcStr(cash),
    equity: usdcStr(accountEquity(state, account)),
    maintenance: usdcStr(usdc(accountMaintenance(state, account))),
    positions,
    orders: [...state.orders.values()]
      .filter((r) => r.account === account)
      .flatMap((r) => {
        const m = state.markets.get(r.market);
        if (m === undefined) return [];
        return [
          {
            orderId: r.orderId,
            market: r.market,
            side: r.qty > 0n ? ('buy' as const) : ('sell' as const),
            size: lotsToQty(m.units, lots(r.qty < 0n ? -r.qty : r.qty)),
            limitPrice: r.limitPrice === null ? null : ticksToPrice(m.units, ticks(r.limitPrice)),
            stop:
              r.stop === null
                ? null
                : {
                    price: ticksToPrice(m.units, ticks(r.stop.price)),
                    triggersOn: r.stop.triggersOn,
                  },
            ocoGroup: r.ocoGroup,
          },
        ];
      }),
  };
}

/** Order outcome for the requester (published on the results channel). */
export function orderResult(
  state: EngineState,
  o: EngineOutput,
  seq: bigint,
): OrderResult | undefined {
  if (o.type === 'OrderRejected') {
    return {
      requestId: o.requestId,
      seq: seq.toString(),
      status: 'rejected',
      duplicate: o.duplicate,
      reason: o.reason,
    };
  }
  if (o.type === 'OrderAccepted')
    return {
      requestId: o.requestId,
      seq: seq.toString(),
      status: 'accepted',
      duplicate: o.duplicate,
      orderId: o.orderId,
    };
  if (o.type === 'OrderCancelled')
    return {
      requestId: o.requestId,
      seq: seq.toString(),
      status: 'cancelled',
      duplicate: false,
      orderId: o.orderId,
      reason: o.reason,
    };
  if (o.type !== 'OrderFilled') return undefined;
  const m = state.markets.get(o.fill.market);
  if (m === undefined) return undefined;
  return {
    requestId: o.requestId,
    seq: seq.toString(),
    status: 'filled',
    duplicate: o.duplicate,
    fill: {
      market: o.fill.market,
      side: o.fill.side,
      size: lotsToQty(m.units, lots(o.fill.qty)),
      price: ticksToPrice(m.units, o.fill.price),
      fee: usdcStr(o.fill.fee),
      realized: usdcStr(o.fill.realized),
    },
  };
}
