import type pg from 'pg';
import type { InstrumentRef, Tick } from '@euroedge/shared';

interface Row {
  ms: bigint;
  source: Tick['source'];
  venue: Tick['instrument']['venue'];
  symbol: string;
  kind: Tick['kind'];
  currency: Tick['currency'];
  bid: number | null;
  ask: number | null;
  last: number | null;
  size: number | null;
}

const COLS = `(extract(epoch FROM ts) * 1000)::bigint AS ms, source, venue, symbol, kind, currency, bid, ask, last, size`;

const toTick = (r: Row): Tick => ({
  source: r.source,
  instrument: { venue: r.venue, symbol: r.symbol },
  ts: Number(r.ms),
  currency: r.currency,
  kind: r.kind,
  ...(r.bid === null ? {} : { bid: r.bid }),
  ...(r.ask === null ? {} : { ask: r.ask }),
  ...(r.last === null ? {} : { last: r.last }),
  ...(r.size === null ? {} : { size: r.size }),
});

/**
 * The minimal tick history that reconstructs FV state after a restart: the latest official
 * close of the primary (anchor C), every other instrument's last tick at or before t_C
 * (ADR/FX references), and each instrument's latest ticks. Returned in time order.
 */
export async function warmStartTicks(
  db: pg.Pool,
  primary: InstrumentRef,
  others: readonly InstrumentRef[],
): Promise<Tick[]> {
  const close = await db.query<Row>(
    `SELECT ${COLS} FROM ticks WHERE venue = $1 AND symbol = $2 AND kind = 'close' AND ts > now() - interval '14 days'
     ORDER BY ts DESC LIMIT 1`,
    [primary.venue, primary.symbol],
  );
  const anchor = close.rows[0];
  if (anchor === undefined) return [];
  const out: Tick[] = [toTick(anchor)];
  for (const inst of [primary, ...others]) {
    const isPrimary = inst === primary;
    const ref = isPrimary
      ? { rows: [] as Row[] }
      : await db.query<Row>(
          `SELECT ${COLS} FROM ticks WHERE venue = $1 AND symbol = $2 AND ts <= to_timestamp($3 / 1000.0)
           AND ts > to_timestamp($3 / 1000.0) - interval '7 days' ORDER BY ts DESC LIMIT 1`,
          [inst.venue, inst.symbol, anchor.ms.toString()],
        );
    const latest = await db.query<Row>(
      `SELECT ${COLS} FROM ticks WHERE venue = $1 AND symbol = $2 AND ts > to_timestamp($3 / 1000.0)
       AND kind <> 'close' ORDER BY ts DESC LIMIT 1`,
      [inst.venue, inst.symbol, anchor.ms.toString()],
    );
    out.push(...ref.rows.map(toTick), ...latest.rows.map(toTick));
  }
  // Stable order: by time; at equal time the anchor's references precede the anchor.
  const isAnchor = (t: Tick) =>
    t.kind === 'close' && t.instrument.venue === primary.venue ? 1 : 0;
  return out.sort((a, b) => a.ts - b.ts || isAnchor(a) - isAnchor(b));
}
