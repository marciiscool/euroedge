import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '@euroedge/db';
import { createLogger, createValkey } from '@euroedge/service-kit';
import { CHANNELS, fvSnapshotSchema, KEYS, STREAMS } from '@euroedge/shared';
import { loadFvParams, loadMarkets } from '@euroedge/shared/config';
import { startFvService } from './service.ts';

const dbUrl = process.env['DATABASE_URL'];
const vkUrl = process.env['VALKEY_URL'];

describe.skipIf(dbUrl === undefined || vkUrl === undefined)('fv-service (integration)', () => {
  const dbName = `euroedge_fv_${process.pid}`;
  let testDb = '';
  const testVk = `${vkUrl ?? ''}/6`;
  const now = Date.now();
  const sec = Math.floor(now / 1000) * 1000;

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: dbUrl });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${dbName}`);
    await admin.end();
    const u = new URL(dbUrl ?? '');
    u.pathname = `/${dbName}`;
    testDb = u.toString();
    await migrate(testDb);
    const c = new pg.Client({ connectionString: testDb });
    await c.connect();
    // Previous close 700.00 one hour ago, Tradegate quoting 707 now.
    await c.query(
      `INSERT INTO ticks (ts, source, venue, symbol, kind, currency, bid, ask, last) VALUES
       (to_timestamp($1 / 1000.0), 'sim', 'XAMS', 'ASML', 'close', 'EUR', NULL, NULL, 700),
       (to_timestamp($2 / 1000.0), 'sim', 'TGAT', 'ASML', 'quote', 'EUR', 706.9, 707.1, NULL)`,
      [now - 3_600_000, sec - 2000],
    );
    await c.end();
    const v = createValkey(testVk, 'setup');
    await v.flushdb();
    v.disconnect();
  });

  afterAll(async () => {
    const admin = new pg.Client({ connectionString: dbUrl });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.end();
  });

  it('warm-starts from the DB, publishes MarketData and a display snapshot, follows live ticks', async () => {
    const fv = await startFvService({
      databaseUrl: testDb,
      valkeyUrl: testVk,
      markets: await loadMarkets(),
      params: await loadFvParams(),
      stepCapBpsPerSecond: 50,
      log: createLogger('fv-test', 'silent'),
    });
    const v = createValkey(testVk, 'reader');
    expect(await fv.evaluateAt(sec)).toBe(1);
    const entries = (await v.xrange(STREAMS.engineInput, '-', '+')) as [string, string[]][];
    const input = JSON.parse(entries.at(-1)?.[1][1] ?? '{}') as { type: string; fv: string };
    expect(input.type).toBe('MarketData');
    // Tradegate is the only live signal if Tradegate is open now; otherwise FV holds at C.
    expect(['70000', '70700']).toContain(input.fv);
    const snap = fvSnapshotSchema.parse(JSON.parse((await v.get(KEYS.fv('ASML-PERP'))) ?? '{}'));
    expect(snap.anchor.price).toBe('700.00');
    expect(snap.nextWindowChange).not.toBeNull();

    // A live tick moves FV.
    const pub = createValkey(testVk, 'pub');
    await pub.publish(
      CHANNELS.ticks,
      JSON.stringify({
        source: 'sim',
        instrument: { venue: 'TGAT', symbol: 'ASML' },
        ts: sec + 500,
        currency: 'EUR',
        kind: 'quote',
        bid: 709.9,
        ask: 710.1,
      }),
    );
    await new Promise((r) => setTimeout(r, 200));
    await fv.evaluateAt(sec + 1000);
    const after = fvSnapshotSchema.parse(JSON.parse((await v.get(KEYS.fv('ASML-PERP'))) ?? '{}'));
    if (after.window !== 'C' && after.window !== 'D') expect(after.fv).toBe('710.00');
    await fv.stop();
    pub.disconnect();
    v.disconnect();
  }, 20_000);
});
