import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { usdc } from '@euroedge/fixed';
import { migrate } from '@euroedge/db';
import type { EngineEvent, EngineInput } from '../src/core/events.ts';
import { EVENT_VERSIONS } from '../src/log/codec.ts';
import { EventStore } from '../src/log/store.ts';
import {
  catchUpProjection,
  project,
  projectionCursor,
  writeProjection,
} from '../src/projections.ts';
import { data, listASML, order, USDC } from './fixtures.ts';

const url = process.env['DATABASE_URL'];

describe.skipIf(url === undefined)('read models (integration, M4-22)', () => {
  const dbName = `euroedge_rm_${process.pid}`;
  let store: EventStore;
  let db: pg.Pool;

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: url });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${dbName}`);
    await admin.end();
    const u = new URL(url ?? '');
    u.pathname = `/${dbName}`;
    await migrate(u.toString());
    store = new EventStore(u.toString());
    await store.acquireWriterLock();
    db = new pg.Pool({ connectionString: u.toString() });
    const inputs: EngineInput[] = [
      {
        type: 'GenesisCapital',
        house: usdc(50_000_000n * USDC),
        insurance: usdc(5_000_000n * USDC),
        source: 'dev',
      },
      listASML,
      data(70_000n),
      { type: 'DevDeposit', account: 'alice', amount: usdc(10_000n * USDC) },
      order('alice', 'buy', 1_000n),
      order('alice', 'sell', 500n),
    ];
    const events: EngineEvent[] = inputs.map((input, i) => ({
      seq: BigInt(i + 1),
      ts: 1_793_000_000_000n + BigInt(i) * 1000n,
      v: EVENT_VERSIONS[input.type],
      input,
    }));
    await store.append(events);
  });

  afterAll(async () => {
    await store.close();
    await db.end();
    const admin = new pg.Client({ connectionString: url });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.end();
  });

  it('catches up from the log once, then has nothing to do', async () => {
    expect(await catchUpProjection(store.readAll(), db)).toBe(6n);
    expect(await projectionCursor(db)).toBe(6n);
    const { rows } = await db.query<{ side: string; qty_lots: string }>(
      'SELECT side, qty_lots::text FROM rm_fills ORDER BY seq',
    );
    expect(rows).toEqual([
      { side: 'buy', qty_lots: '1000' },
      { side: 'sell', qty_lots: '500' },
    ]);
    expect(await catchUpProjection(store.readAll(), db)).toBe(0n);
  });

  it('is idempotent: writing the same rows again changes nothing and the cursor never moves back', async () => {
    const rows = project([
      {
        seq: 5n,
        ts: 1n,
        output: {
          type: 'OrderFilled',
          requestId: 'r',
          account: 'alice',
          duplicate: false,
          fill: {
            market: 'ASML-PERP',
            side: 'buy',
            qty: 1_000n,
            price: 70_035n as never,
            fee: 1n as never,
            realized: 0n as never,
          },
        },
      },
    ]);
    await writeProjection(db, rows, 5n);
    const { rows: n } = await db.query<{ c: string }>('SELECT count(*)::text AS c FROM rm_fills');
    expect(n[0]?.c).toBe('2');
    expect(await projectionCursor(db)).toBe(6n);
  });
});
