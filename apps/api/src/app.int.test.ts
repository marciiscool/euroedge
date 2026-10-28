import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { migrate } from '@euroedge/db';
import { ExecutionError, type ExecutionAdapter } from '@euroedge/execution';
import { createService, createValkey, type Redis, type Service } from '@euroedge/service-kit';
import { CHANNELS, KEYS, STREAMS } from '@euroedge/shared';
import { buildApi, SESSION_COOKIE } from './app.ts';

const dbUrl = process.env['DATABASE_URL'];
const vkUrl = process.env['VALKEY_URL'];
const ORIGIN = 'http://localhost:8080';
const MARKET = {
  market: 'ASML-PERP',
  seq: '1',
  ts: 0,
  window: 'A',
  fv: '700.00',
  bandLo: '699.00',
  bandHi: '701.00',
  index: '700.00',
  mark: '700.00',
  bid: '699.65',
  ask: '700.35',
  sigmaBp: 5,
  maxLeverage: 5,
  takerFeeBps: 5,
  tickSize: '0.01',
  lotSize: '0.01',
  minNotional: '10.000000',
};

describe.skipIf(dbUrl === undefined || vkUrl === undefined)('api (integration)', () => {
  const dbName = `euroedge_api_${process.pid}`;
  let svc: Service;
  let base = '';
  let valkey: Redis;
  let subscriber: Redis;
  let db: pg.Pool;
  const placed: unknown[] = [];

  const adapter: ExecutionAdapter = {
    placeOrder: (o) => {
      placed.push(o);
      return o.size === '999'
        ? Promise.reject(new ExecutionError('timeout', 'engine did not answer'))
        : Promise.resolve({
            requestId: 'r',
            seq: '2',
            status: 'filled',
            duplicate: false,
            fill: {
              market: o.market,
              side: o.side,
              size: o.size,
              price: '700.35',
              fee: '0.35',
              realized: '0.000000',
            },
          });
    },
    closePosition: () =>
      Promise.resolve({
        requestId: 'r',
        seq: '3',
        status: 'rejected',
        duplicate: false,
        reason: 'no-position',
      }),
    cancelOrder: (_a, id) =>
      Promise.resolve({
        requestId: 'r',
        seq: '4',
        status: 'cancelled',
        duplicate: false,
        orderId: id,
        reason: 'user',
      }),
    streamFills: () => () => undefined,
    positions: () => Promise.resolve([]),
    account: (a) =>
      Promise.resolve({
        account: a,
        seq: '1',
        cash: '10000.000000',
        equity: '10000.000000',
        maintenance: '0.000000',
        positions: [],
        orders: [],
      }),
  };

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: dbUrl });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${dbName}`);
    await admin.end();
    const u = new URL(dbUrl ?? '');
    u.pathname = `/${dbName}`;
    await migrate(u.toString());
    db = new pg.Pool({ connectionString: u.toString() });
    await db.query(`INSERT INTO fv_series (ts, market, win, fv, band_lo, band_hi, idx, mark, sigma_bp, confidence)
                    VALUES (now() - interval '10 seconds', 'ASML-PERP', 'A', 700, 699, 701, 700, 700, 5, 'high')`);
    valkey = createValkey(`${vkUrl ?? ''}/3`, 'api-test');
    subscriber = createValkey(`${vkUrl ?? ''}/3`, 'api-test-sub');
    await valkey.flushdb();
    await valkey.set(KEYS.market('ASML-PERP'), JSON.stringify(MARKET));
    svc = createService({ name: 'api-test', port: 0, logLevel: 'silent' });
    await buildApi(svc.http, {
      adapter,
      valkey,
      subscriber,
      db,
      markets: [{ id: 'ASML-PERP', displayName: 'ASML Holding', kind: 'stock' }],
      config: {
        PUBLIC_ORIGIN: ORIGIN,
        SESSION_SECRET: 'x'.repeat(32),
        DEV_LOGIN: true,
        DATA_TIER: 'sim',
        DEPLOY_ENV: 'ci',
        DEV_FAUCET_USDC: 10_000,
      },
    });
    base = await svc.listen();
  });

  afterAll(async () => {
    await svc.close();
    valkey.disconnect();
    subscriber.disconnect();
    await db.end();
    const admin = new pg.Client({ connectionString: dbUrl });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.end();
  });

  const post = (url: string, body: unknown, cookie?: string, origin = ORIGIN) =>
    svc.http.inject({
      method: 'POST',
      url,
      payload: body as object,
      headers: {
        origin,
        'content-type': 'application/json',
        ...(cookie === undefined ? {} : { cookie }),
      },
    });

  async function login(): Promise<string> {
    const res = await post('/api/dev/login', { name: 'alice' });
    expect(res.statusCode).toBe(200);
    const c = res.cookies.find((x) => x.name === SESSION_COOKIE);
    expect(c?.httpOnly).toBe(true);
    expect(c?.sameSite).toBe('Lax');
    return `${SESSION_COOKIE}=${c?.value ?? ''}`;
  }

  it('dev login sets a signed session and credits play money exactly once', async () => {
    const cookie = await login();
    const again = await post('/api/dev/login', {}, cookie);
    const first = (await svc.http.inject({ url: '/api/session', headers: { cookie } })).json<{
      account: string;
    }>();
    expect(again.json()).toEqual({ account: first.account });
    const deposits = (await valkey.xrange(STREAMS.engineInput, '-', '+')) as [string, string[]][];
    expect(deposits.filter(([, f]) => (f[1] ?? '').includes('DevDeposit'))).toHaveLength(1);
    const session = (await svc.http.inject({ url: '/api/session', headers: { cookie } })).json<{
      account: string;
      devLogin: boolean;
    }>();
    expect(session.account).toMatch(/^dev-alice-[0-9a-f]{6}$/);
    expect(session.devLogin).toBe(true);
    // A tampered cookie is not a session.
    const forged = (
      await svc.http.inject({
        url: '/api/session',
        headers: { cookie: `${SESSION_COOKIE}=dev-mallory.abc` },
      })
    ).json<{ account: null }>();
    expect(forged.account).toBeNull();
  });

  it('guards mutating requests: same origin, JSON, authentication', async () => {
    expect((await post('/api/dev/login', {}, undefined, 'https://evil.example')).statusCode).toBe(
      403,
    );
    expect(
      (
        await svc.http.inject({
          method: 'POST',
          url: '/api/dev/login',
          payload: {},
          headers: { 'content-type': 'application/json' },
        })
      ).statusCode,
    ).toBe(403);
    const noJson = await svc.http.inject({
      method: 'POST',
      url: '/api/orders',
      payload: 'x',
      headers: { origin: ORIGIN, 'content-type': 'text/plain' },
    });
    expect(noJson.statusCode).toBe(400);
    const anon = await post('/api/orders', {
      market: 'ASML-PERP',
      side: 'buy',
      size: '1',
      idempotencyKey: 'kkkkkkkk1',
    });
    expect(anon.statusCode).toBe(401);
    expect(anon.json()).toMatchObject({ error: { code: 'unauthenticated' } });
  });

  it('places orders through the adapter, validates input, maps adapter errors', async () => {
    const cookie = await login();
    const ok = await post(
      '/api/orders',
      { market: 'ASML-PERP', side: 'buy', size: '1.50', idempotencyKey: 'order-0001' },
      cookie,
    );
    expect(ok.json()).toMatchObject({ status: 'filled', fill: { size: '1.50' } });
    expect(placed.at(-1)).toMatchObject({ type: 'market', reduceOnly: false, size: '1.50' });
    expect(
      (
        await post(
          '/api/orders',
          { market: 'ASML-PERP', side: 'buy', size: '-1', idempotencyKey: 'order-0002' },
          cookie,
        )
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await post(
          '/api/orders',
          { market: 'ASML-PERP', side: 'buy', size: '999', idempotencyKey: 'order-0003' },
          cookie,
        )
      ).statusCode,
    ).toBe(504);
    expect(
      (
        await post(
          '/api/orders',
          {
            market: 'ASML-PERP',
            side: 'buy',
            size: '1',
            type: 'limit',
            idempotencyKey: 'order-0004',
          },
          cookie,
        )
      ).statusCode,
    ).toBe(400);
    await post(
      '/api/orders',
      {
        market: 'ASML-PERP',
        side: 'buy',
        size: '1',
        type: 'limit',
        limitPrice: '690.00',
        idempotencyKey: 'order-0005',
      },
      cookie,
    );
    expect(placed.at(-1)).toMatchObject({ type: 'limit', limitPrice: '690.00' });
    const del = await svc.http.inject({
      method: 'DELETE',
      url: '/api/orders/order-0005',
      payload: {},
      headers: { origin: ORIGIN, 'content-type': 'application/json', cookie },
    });
    expect(del.json()).toMatchObject({ status: 'cancelled', orderId: 'order-0005' });
    const close = await post(
      '/api/positions/ASML-PERP/close',
      { idempotencyKey: 'close-0001' },
      cookie,
    );
    expect(close.json()).toMatchObject({ status: 'rejected', reason: 'no-position' });
    expect(
      (await svc.http.inject({ url: '/api/account', headers: { cookie } })).json(),
    ).toMatchObject({ cash: '10000.000000' });
  });

  it('lists enabled markets', async () => {
    expect((await svc.http.inject({ url: '/api/markets' })).json()).toEqual({
      markets: [{ id: 'ASML-PERP', displayName: 'ASML Holding', kind: 'stock' }],
    });
  });

  it('serves market snapshots and FV history', async () => {
    expect((await svc.http.inject({ url: '/api/markets/ASML-PERP' })).json()).toMatchObject({
      market: { mark: '700.00' },
      fv: null,
    });
    expect((await svc.http.inject({ url: '/api/markets/NOPE-PERP' })).statusCode).toBe(404);
    const hist = (await svc.http.inject({ url: '/api/markets/ASML-PERP/fv?minutes=30' })).json<{
      points: { fv: string }[];
    }>();
    expect(hist.points[0]?.fv).toBe('700');
  });

  it('WebSocket: snapshot on subscribe, live updates, account bound to the cookie, origin checked', async () => {
    const cookie = await login();
    const url = base.replace('http', 'ws') + '/ws';
    const ws = new WebSocket(url, { headers: { origin: ORIGIN, cookie } });
    const msgs: { ch?: string; snapshot?: boolean; error?: unknown }[] = [];
    ws.on('message', (m: Buffer) => msgs.push(JSON.parse(m.toString()) as (typeof msgs)[number]));
    await new Promise((r) => ws.on('open', r));
    ws.send(JSON.stringify({ op: 'sub', ch: 'market:ASML-PERP' }));
    ws.send(JSON.stringify({ op: 'sub', ch: 'account' }));
    ws.send(JSON.stringify({ op: 'sub', ch: 'account:someone-else' }));
    await new Promise((r) => setTimeout(r, 200));
    await valkey.publish(
      CHANNELS.market('ASML-PERP'),
      JSON.stringify({ ...MARKET, mark: '701.00' }),
    );
    await new Promise((r) => setTimeout(r, 200));
    expect(msgs.find((m) => m.ch === 'market:ASML-PERP' && m.snapshot === true)).toBeDefined();
    // Pub/sub is not scoped to a Valkey database, so a locally running stack may add messages.
    expect(
      msgs.some(
        (m) =>
          m.ch === 'market:ASML-PERP' &&
          m.snapshot !== true &&
          JSON.stringify(m).includes('701.00'),
      ),
    ).toBe(true);
    expect(msgs.some((m) => m.error !== undefined)).toBe(true);
    ws.close();

    const evil = new WebSocket(url, { headers: { origin: 'https://evil.example' } });
    const code = await new Promise<number>((r) => evil.on('close', (c: number) => r(c)));
    expect(code).toBe(1008);
  });
});
