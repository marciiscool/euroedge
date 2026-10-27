import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger, createValkey } from '@euroedge/service-kit';
import { CHANNELS, KEYS, orderResultSchema, type OrderResult } from '@euroedge/shared';
import { loadMarkets, loadWindows } from '@euroedge/shared/config';
import { enqueueInput, startEngine } from '../src/engine.ts';
import { stateDigest } from '../src/log/digest.ts';
import { data } from './fixtures.ts';

const dbUrl = process.env['DATABASE_URL'];
const vkUrl = process.env['VALKEY_URL'];

// End-to-end: Valkey stream → sequencer → Postgres log → results/snapshots; restart replays.
describe.skipIf(dbUrl === undefined || vkUrl === undefined)('engine service (integration)', () => {
  const dbName = `euroedge_engine_${process.pid}`;
  let testDb = '';
  // Isolated Valkey logical database for this test.
  const testVk = `${vkUrl ?? ''}/7`;

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: dbUrl });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${dbName}`);
    await admin.end();
    const u = new URL(dbUrl ?? '');
    u.pathname = `/${dbName}`;
    testDb = u.toString();
    const v = createValkey(testVk, 'test-setup');
    await v.flushdb();
    v.disconnect();
  });

  afterAll(async () => {
    const admin = new pg.Client({ connectionString: dbUrl });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.end();
  });

  it('fills an order end to end and rebuilds identical state after a restart', async () => {
    const opts = {
      databaseUrl: testDb,
      valkeyUrl: testVk,
      tier: 'sim' as const,
      markets: await loadMarkets(),
      windows: await loadWindows(),
      log: createLogger('engine-test', 'silent'),
      clockTickMs: 60_000,
    };
    const engine = await startEngine(opts);
    const client = createValkey(testVk, 'test-client');
    const sub = createValkey(testVk, 'test-sub');
    const results: OrderResult[] = [];
    await sub.subscribe(CHANNELS.results);
    sub.on('message', (_ch, m) => results.push(orderResultSchema.parse(JSON.parse(m))));

    await enqueueInput(client, data(70_000n));
    await enqueueInput(client, { type: 'DevDeposit', account: 'it', amount: 10_000_000_000n });
    await enqueueInput(client, {
      type: 'PlaceOrder',
      requestId: 'req-1',
      idempotencyKey: 'k1',
      account: 'it',
      market: 'ASML-PERP',
      side: 'buy',
      qty: 100n,
      reduceOnly: false,
    });
    for (let i = 0; i < 50 && results.length === 0; i++)
      await new Promise((r) => setTimeout(r, 100));
    expect(results[0]).toMatchObject({
      requestId: 'req-1',
      status: 'filled',
      fill: { price: '700.35', size: '1.00' },
    });
    const snap = JSON.parse((await client.get(KEYS.account('it'))) ?? '{}') as {
      positions: { size: string }[];
    };
    expect(snap.positions[0]?.size).toBe('1.00');

    const digest = stateDigest(engine.state);
    await engine.stop();
    const restarted = await startEngine(opts);
    expect(stateDigest(restarted.state)).toBe(digest);
    await restarted.stop();
    sub.disconnect();
    client.disconnect();
  }, 30_000);
});
