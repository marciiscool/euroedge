import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '@euroedge/db';
import { TickWriter } from './writer.ts';

const url = process.env['DATABASE_URL'];

describe.skipIf(url === undefined)('TickWriter (integration)', () => {
  const dbName = `euroedge_ticks_${process.pid}`;
  let testUrl = '';

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: url });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${dbName}`);
    await admin.end();
    const u = new URL(url ?? '');
    u.pathname = `/${dbName}`;
    testUrl = u.toString();
    await migrate(testUrl);
  });

  afterAll(async () => {
    const admin = new pg.Client({ connectionString: url });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.end();
  });

  it('batch-inserts ticks into the hypertable with ms precision', async () => {
    const w = new TickWriter(testUrl);
    w.push({
      source: 'sim',
      instrument: { venue: 'TGAT', symbol: 'ASML' },
      ts: 1_793_000_000_123,
      currency: 'EUR',
      kind: 'quote',
      bid: 700.1,
      ask: 700.3,
    });
    w.push({
      source: 'sim',
      instrument: { venue: 'XAMS', symbol: 'ASML' },
      ts: 1_793_000_001_000,
      currency: 'EUR',
      kind: 'close',
      last: 700.2,
    });
    expect(await w.flush()).toBe(2);
    expect(await w.flush()).toBe(0);
    await w.close();
    const c = new pg.Client({ connectionString: testUrl });
    await c.connect();
    const { rows } = await c.query<{ ms: bigint; venue: string; bid: number | null }>(
      'SELECT (extract(epoch FROM ts) * 1000)::bigint AS ms, venue, bid FROM ticks ORDER BY ts',
    );
    await c.end();
    expect(rows).toEqual([
      { ms: 1_793_000_000_123n, venue: 'TGAT', bid: 700.1 },
      { ms: 1_793_000_001_000n, venue: 'XAMS', bid: null },
    ]);
  });
});
