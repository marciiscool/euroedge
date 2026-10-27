import pg from 'pg';
import type { Tick } from '@euroedge/shared';

/** Batched tick inserts into the Timescale hypertable. */
export class TickWriter {
  private readonly pool: pg.Pool;
  private buffer: Tick[] = [];
  /** Last row per instrument and kind, to drop exact duplicates (reconnects, replays). */
  private readonly last = new Map<string, string>();
  duplicates = 0;

  constructor(databaseUrl: string) {
    this.pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
  }

  /** Buffers a tick; returns false for an exact duplicate of the previous row of its stream. */
  push(t: Tick): boolean {
    const stream = `${t.instrument.venue}:${t.instrument.symbol}|${t.kind}`;
    const row = `${t.ts}|${t.bid}|${t.ask}|${t.last}|${t.size}`;
    if (this.last.get(stream) === row) {
      this.duplicates++;
      return false;
    }
    this.last.set(stream, row);
    this.buffer.push(t);
    return true;
  }

  async flush(): Promise<number> {
    const rows = this.buffer;
    if (rows.length === 0) return 0;
    this.buffer = [];
    await this.pool.query(
      `INSERT INTO ticks (ts, source, venue, symbol, kind, currency, bid, ask, last, size)
       SELECT to_timestamp(t / 1000.0), s, v, sy, k, c, b, a, l, z
       FROM unnest($1::bigint[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[],
                   $7::float8[], $8::float8[], $9::float8[], $10::float8[]) AS u(t, s, v, sy, k, c, b, a, l, z)`,
      [
        rows.map((r) => r.ts),
        rows.map((r) => r.source),
        rows.map((r) => r.instrument.venue),
        rows.map((r) => r.instrument.symbol),
        rows.map((r) => r.kind),
        rows.map((r) => r.currency),
        rows.map((r) => r.bid ?? null),
        rows.map((r) => r.ask ?? null),
        rows.map((r) => r.last ?? null),
        rows.map((r) => r.size ?? null),
      ],
    );
    return rows.length;
  }

  close(): Promise<void> {
    return this.pool.end();
  }
}
