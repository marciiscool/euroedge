import type pg from 'pg';
import { apply } from './core/apply.ts';
import type { EngineOutput } from './core/outputs.ts';
import { createState } from './core/state.ts';
import { decodeEvent } from './log/codec.ts';
import type { StoredRecord } from './log/store.ts';

/**
 * Read-model projections (M4-22). Pure mapping from engine outputs to rows; the writer
 * stores them with the projection cursor in one transaction, keyed by (seq, n), so
 * replaying a batch twice changes nothing.
 */
export interface ProjectedOutput {
  readonly seq: bigint;
  readonly ts: bigint;
  readonly output: EngineOutput;
}

export interface Rows {
  readonly fills: unknown[][];
  readonly orders: unknown[][];
  readonly liquidations: unknown[][];
  readonly cashFlows: unknown[][];
}

export function project(outputs: readonly ProjectedOutput[]): Rows {
  const rows: Rows = { fills: [], orders: [], liquidations: [], cashFlows: [] };
  const n = new Map<bigint, number>();
  for (const { seq, ts, output: o } of outputs) {
    const i = n.get(seq) ?? 0;
    n.set(seq, i + 1);
    const key = [seq, i, ts];
    switch (o.type) {
      case 'OrderFilled':
        if (o.duplicate) break;
        rows.fills.push([
          ...key,
          o.account,
          o.fill.market,
          o.fill.side,
          o.fill.qty,
          o.fill.price,
          o.fill.fee,
          o.fill.realized,
          o.requestId,
        ]);
        break;
      case 'OrderAccepted':
        if (!o.duplicate)
          rows.orders.push([...key, o.account, o.requestId, o.orderId, 'accepted', null]);
        break;
      case 'OrderCancelled':
        rows.orders.push([...key, o.account, o.requestId, o.orderId, 'cancelled', o.reason]);
        break;
      case 'OrderRejected':
        if (!o.duplicate)
          rows.orders.push([...key, o.account, o.requestId, null, 'rejected', o.reason]);
        break;
      case 'Liquidated':
        rows.liquidations.push([
          ...key,
          o.account,
          [...o.markets],
          o.penalty,
          o.insuranceCover,
          o.partial,
        ]);
        break;
      case 'CashFlow':
        rows.cashFlows.push([...key, o.account, o.kind, o.market, null, o.amount]);
        break;
      case 'WithdrawalReserved':
        if (!o.duplicate)
          rows.cashFlows.push([
            ...key,
            o.account,
            'withdrawal-reserved',
            null,
            o.withdrawalId,
            -o.amount,
          ]);
        break;
      case 'WithdrawalSettled':
        rows.cashFlows.push([
          ...key,
          o.account,
          `withdrawal-${o.outcome}`,
          null,
          o.withdrawalId,
          o.outcome === 'expired' ? o.amount : 0n,
        ]);
        break;
      default:
        break;
    }
  }
  return rows;
}

const TABLES: Record<keyof Rows, { table: string; cols: string[] }> = {
  fills: {
    table: 'rm_fills',
    cols: [
      'seq',
      'n',
      'ts_ms',
      'account',
      'market',
      'side',
      'qty_lots',
      'price_ticks',
      'fee',
      'realized',
      'request_id',
    ],
  },
  orders: {
    table: 'rm_orders',
    cols: ['seq', 'n', 'ts_ms', 'account', 'request_id', 'order_id', 'status', 'reason'],
  },
  liquidations: {
    table: 'rm_liquidations',
    cols: ['seq', 'n', 'ts_ms', 'account', 'markets', 'penalty', 'insurance_cover', 'partial'],
  },
  cashFlows: {
    table: 'rm_cash_flows',
    cols: ['seq', 'n', 'ts_ms', 'account', 'kind', 'market', 'ref', 'amount'],
  },
};

const pgValue = (v: unknown): unknown => (typeof v === 'bigint' ? v.toString() : v);

/** Writes projected rows and advances the cursor to `upTo`, atomically and idempotently. */
export async function writeProjection(db: pg.Pool, rows: Rows, upTo: bigint): Promise<void> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    for (const k of Object.keys(TABLES) as (keyof Rows)[]) {
      const { table, cols } = TABLES[k];
      // ≤ 500 rows per statement keeps parameters well under Postgres' 65 535 limit.
      for (let i = 0; i < rows[k].length; i += 500) {
        const chunk = rows[k].slice(i, i + 500);
        const params: unknown[] = [];
        const tuples = chunk.map((r) => {
          const ph = r.map((v) => {
            params.push(pgValue(v));
            return `$${params.length}`;
          });
          return `(${ph.join(',')})`;
        });
        await client.query(
          `INSERT INTO ${table} (${cols.join(',')}) VALUES ${tuples.join(',')} ON CONFLICT DO NOTHING`,
          params,
        );
      }
    }
    await client.query(
      `INSERT INTO rm_cursor (id, seq) VALUES (1, $1)
       ON CONFLICT (id) DO UPDATE SET seq = GREATEST(rm_cursor.seq, EXCLUDED.seq)`,
      [upTo.toString()],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export async function projectionCursor(db: pg.Pool): Promise<bigint> {
  const { rows } = await db.query<{ seq: string }>('SELECT seq::text FROM rm_cursor WHERE id = 1');
  return rows[0] === undefined ? 0n : BigInt(rows[0].seq);
}

/**
 * Rebuilds the projection from the log for every event after the cursor (startup, or after
 * a projection write failed). Replays from genesis on a fresh state: outputs are not logged.
 */
export async function catchUpProjection(
  records: AsyncIterable<StoredRecord>,
  db: pg.Pool,
  flushEvery = 5_000,
): Promise<bigint> {
  const cursor = await projectionCursor(db);
  const state = createState();
  let pending: ProjectedOutput[] = [];
  let last = cursor;
  for await (const rec of records) {
    const e = decodeEvent(rec.body);
    for (const output of apply(state, e))
      if (e.seq > cursor) pending.push({ seq: e.seq, ts: e.ts, output });
    if (e.seq > cursor) last = e.seq;
    if (e.seq > cursor && e.seq % BigInt(flushEvery) === 0n) {
      await writeProjection(db, project(pending), last);
      pending = [];
    }
  }
  if (last > cursor) await writeProjection(db, project(pending), last);
  return last - cursor;
}
