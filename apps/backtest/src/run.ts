import { calendarFor } from '@euroedge/calendar';
import { MarketFvPipeline } from '@euroedge/fv-core';
import { DateTime } from 'luxon';
import {
  instrumentKey,
  WINDOWS,
  type FvParams,
  type MarketConfig,
  type Tick,
  type Window,
} from '@euroedge/shared';
import { normCdf, summarize, type BacktestReport, type Resolved } from './metrics.ts';

interface Pending {
  readonly ts: number;
  readonly window: Window;
  readonly fv: number;
  readonly sigma: number;
  readonly bandLo: number;
  readonly bandHi: number;
  readonly anchor: number;
}

export interface RunOptions {
  readonly markets: readonly MarketConfig[];
  readonly params: FvParams;
  readonly stepCapBpsPerSecond: number;
  /** FV sampling cadence in event time (default 15 min). */
  readonly evaluateEverySeconds?: number;
  readonly data: readonly string[];
}

/** EUR per unit of a primary line currency, from the latest FX ticks. */
function toEur(t: Tick, fx: ReadonlyMap<string, number>): number | undefined {
  const px = t.last;
  if (px === undefined) return undefined;
  switch (t.currency) {
    case 'EUR':
      return px;
    case 'GBX': {
      const r = fx.get('EURGBP');
      return r === undefined ? undefined : px / 100 / r;
    }
    case 'DKK': {
      const r = fx.get('EURDKK');
      return r === undefined ? undefined : px / r;
    }
    default:
      return undefined;
  }
}

/**
 * Replays ticks through the production fv-core pipeline (brief §6.6, no duplicated maths).
 * FV is sampled every N seconds of event time; each sample is scored against the next official
 * open (the primary's opening-auction print) and against the naive "last close".
 */
export function runBacktest(ticks: readonly Tick[], o: RunOptions): BacktestReport {
  const every = (o.evaluateEverySeconds ?? 900) * 1000;
  const runs = o.markets
    .filter((m) => m.kind === 'stock')
    .map((m) => ({
      m,
      pipe: new MarketFvPipeline(m, o.params, o.stepCapBpsPerSecond),
      primary: `${m.primaryMic}:${m.primarySymbol ?? ''}`,
      pending: [] as Pending[],
      resolved: [] as (Resolved & { window: Window })[],
      opens: 0,
      nextEval: undefined as number | undefined,
      // Local ex-dates: a sample taken cum-dividend is scored against an ex-dividend open net of D.
      dividends: (m.sim?.dividends ?? []).map((d) => ({
        at: DateTime.fromISO(d.exDate, { zone: calendarFor(m.primaryMic).tz }).toMillis(),
        gross: Number(d.gross),
      })),
    }));
  const fx = new Map<string, number>();
  for (const t of ticks) {
    if (t.instrument.venue === 'FX' && t.bid !== undefined && t.ask !== undefined)
      fx.set(t.instrument.symbol, (t.bid + t.ask) / 2);
    const key = instrumentKey(t.instrument);
    for (const r of runs) {
      // Sample on the event clock before applying this tick (no look-ahead).
      r.nextEval ??= t.ts;
      while (r.nextEval <= t.ts) {
        const out = r.pipe.evaluate(r.nextEval);
        if (out !== undefined) {
          const s = out.snapshot;
          r.pending.push({
            ts: r.nextEval,
            window: s.window,
            fv: s.fv,
            sigma: s.sigma,
            bandLo: s.bandLo,
            bandHi: s.bandHi,
            anchor: s.anchor.price,
          });
        }
        r.nextEval += every;
      }
      if (key === r.primary && t.kind === 'auction') {
        const open = toEur(t, fx);
        if (open !== undefined) {
          r.opens += 1;
          for (const p of r.pending) {
            const d = r.dividends
              .filter((x) => x.at > p.ts && x.at <= t.ts)
              .reduce((a, x) => a + x.gross, 0);
            const fv = p.fv - d;
            r.resolved.push({
              window: p.window,
              errBp: 1e4 * Math.log(fv / open),
              naiveBp: 1e4 * Math.log((p.anchor - d) / open),
              inBand: open >= p.bandLo - d && open <= p.bandHi - d,
              pit: normCdf(Math.log(open / fv) / p.sigma),
            });
          }
          r.pending = [];
        }
      }
      r.pipe.onTick(t);
    }
  }
  return {
    version: 1,
    data: [...o.data],
    evaluateEverySeconds: every / 1000,
    markets: Object.fromEntries(
      runs.map((r) => [
        r.m.id,
        {
          opens: r.opens,
          all: summarize(r.resolved),
          byWindow: Object.fromEntries(
            WINDOWS.map((w) => [w, summarize(r.resolved.filter((x) => x.window === w))]),
          ) as BacktestReport['markets'][string]['byWindow'],
        },
      ]),
    ),
    notes: [
      'Errors are 1e4·ln(FV/open) against the primary opening-auction print, sampled before the open (no look-ahead).',
      'Baskets, the false-liquidation rate and the informed-arbitrageur PnL arrive with the M4 engine bots.',
    ],
  };
}
