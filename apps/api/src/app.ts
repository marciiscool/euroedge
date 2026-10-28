import { randomBytes, randomUUID } from 'node:crypto';
import cookie from '@fastify/cookie';
import websocket from '@fastify/websocket';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { ExecutionError, type ExecutionAdapter } from '@euroedge/execution';
import type { Redis } from '@euroedge/service-kit';
import {
  encodeEngineCommand,
  ENGINE_STREAM_MAXLEN,
  fvSnapshotSchema,
  KEYS,
  marketSnapshotSchema,
  STREAMS,
  type DataTier,
} from '@euroedge/shared';
import { registerSocket } from './ws.ts';

export interface ApiDeps {
  readonly adapter: ExecutionAdapter;
  /** Commands and state reads. */
  readonly valkey: Redis;
  /** Dedicated pub/sub connection for the WebSocket fan-out. */
  readonly subscriber: Redis;
  readonly db: pg.Pool;
  /** Enabled markets from config/markets.yaml, listed by GET /api/markets. */
  readonly markets?: readonly { id: string; displayName: string; kind: 'stock' | 'basket' }[];
  readonly config: {
    readonly PUBLIC_ORIGIN: string;
    readonly SESSION_SECRET: string;
    readonly DEV_LOGIN: boolean;
    readonly DATA_TIER: DataTier;
    readonly DEPLOY_ENV: string;
    readonly DEV_FAUCET_USDC: number;
  };
}

export const SESSION_COOKIE = 'ee_session';
const MARKET_ID = /^[A-Z0-9]+-PERP$/;

type ErrorCode =
  'bad-request' | 'unauthenticated' | 'forbidden' | 'not-found' | 'timeout' | 'unavailable';
const STATUS: Record<ErrorCode, number> = {
  'bad-request': 400,
  unauthenticated: 401,
  forbidden: 403,
  'not-found': 404,
  timeout: 504,
  unavailable: 503,
};

/** Structured error body (brief §9): { error: { code, message }, requestId }. */
export function sendError(reply: FastifyReply, code: ErrorCode, message: string) {
  return reply.code(STATUS[code]).send({ error: { code, message }, requestId: reply.request.id });
}

const orderBody = z
  .object({
    market: z.string().regex(MARKET_ID),
    side: z.enum(['buy', 'sell']),
    size: z.string().regex(/^\d+(\.\d+)?$/),
    type: z.enum(['market', 'limit']).default('market'),
    limitPrice: z
      .string()
      .regex(/^\d+(\.\d+)?$/)
      .optional(),
    reduceOnly: z.boolean().default(false),
    idempotencyKey: z.string().min(8).max(64),
  })
  .refine((o) => o.type === 'market' || o.limitPrice !== undefined, {
    message: 'limit orders need limitPrice',
    path: ['limitPrice'],
  });
const closeBody = z.object({ idempotencyKey: z.string().min(8).max(64) });
const loginBody = z.object({
  name: z
    .string()
    .regex(/^[a-z0-9-]{1,24}$/)
    .optional(),
});

/** Registers all API routes on a Fastify instance (built by service-kit). */
export async function buildApi(app: FastifyInstance, deps: ApiDeps): Promise<void> {
  const { adapter, valkey, db, config } = deps;
  await app.register(cookie, { secret: config.SESSION_SECRET });
  await app.register(websocket, { options: { maxPayload: 16 * 1024 } });
  const secure = config.DEPLOY_ENV !== 'local' && config.DEPLOY_ENV !== 'ci';

  const accountOf = (req: FastifyRequest): string | undefined => {
    const raw = req.cookies[SESSION_COOKIE];
    if (raw === undefined) return undefined;
    const r = req.unsignCookie(raw);
    return r.valid && r.value !== null ? r.value : undefined;
  };

  // Same-origin + JSON for every mutating request (CSRF defence until M6 adds tokens).
  app.addHook('preHandler', async (req, reply) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return;
    if (req.headers.origin !== config.PUBLIC_ORIGIN)
      return sendError(reply, 'forbidden', 'cross-origin request');
    if (!(req.headers['content-type'] ?? '').startsWith('application/json')) {
      return sendError(reply, 'bad-request', 'expected application/json');
    }
  });

  app.get('/api/session', (req) => ({
    account: accountOf(req) ?? null,
    devLogin: config.DEV_LOGIN,
    tier: config.DATA_TIER,
  }));

  app.post('/api/dev/login', async (req, reply) => {
    if (!config.DEV_LOGIN) return sendError(reply, 'not-found', 'dev login is disabled');
    const body = loginBody.safeParse(req.body ?? {});
    if (!body.success) return sendError(reply, 'bad-request', 'name: 1–24 chars of a-z, 0-9, -');
    const account =
      accountOf(req) ?? `dev-${body.data.name ?? 'trader'}-${randomBytes(3).toString('hex')}`;
    // Credit play money once per dev account.
    if ((await valkey.set(`devlogin:${account}`, '1', 'NX')) === 'OK') {
      await valkey.xadd(
        STREAMS.engineInput,
        'MAXLEN',
        '~',
        String(ENGINE_STREAM_MAXLEN),
        '*',
        'input',
        encodeEngineCommand({
          type: 'DevDeposit',
          account,
          amount: BigInt(config.DEV_FAUCET_USDC) * 1_000_000n,
        }),
      );
    }
    reply.setCookie(SESSION_COOKIE, account, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure,
      signed: true,
      maxAge: 30 * 86_400,
    });
    return { account };
  });

  app.post('/api/dev/logout', (_req, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { account: null };
  });

  const marketList = (deps.markets ?? []).map(({ id, displayName, kind }) => ({
    id,
    displayName,
    kind,
  }));
  app.get('/api/markets', () => ({ markets: marketList }));

  app.get<{ Params: { id: string } }>('/api/markets/:id', async (req, reply) => {
    if (!MARKET_ID.test(req.params.id)) return sendError(reply, 'not-found', 'unknown market');
    const [m, f] = await valkey.mget(KEYS.market(req.params.id), KEYS.fv(req.params.id));
    if (m === null || m === undefined)
      return sendError(reply, 'not-found', 'no data for this market yet');
    return {
      market: marketSnapshotSchema.parse(JSON.parse(m)),
      fv: f === null || f === undefined ? null : fvSnapshotSchema.parse(JSON.parse(f)),
    };
  });

  app.get<{ Params: { id: string }; Querystring: { minutes?: string } }>(
    '/api/markets/:id/fv',
    async (req, reply) => {
      if (!MARKET_ID.test(req.params.id)) return sendError(reply, 'not-found', 'unknown market');
      const minutes = Math.min(Math.max(Number(req.query.minutes ?? 120) || 120, 5), 24 * 60);
      const bucket = minutes <= 180 ? '5 seconds' : '1 minute';
      const { rows } = await db.query<{
        t: bigint;
        fv: string;
        lo: string;
        hi: string;
        mark: string;
        win: string;
      }>(
        `SELECT (extract(epoch FROM time_bucket($3::interval, ts)) * 1000)::bigint AS t,
              last(fv, ts)::text AS fv, last(band_lo, ts)::text AS lo, last(band_hi, ts)::text AS hi,
              last(mark, ts)::text AS mark, last(win, ts) AS win
       FROM fv_series WHERE market = $1 AND ts > now() - make_interval(mins => $2::int)
       GROUP BY 1 ORDER BY 1`,
        [req.params.id, minutes, bucket],
      );
      return {
        market: req.params.id,
        points: rows.map((r) => ({
          t: Number(r.t),
          fv: r.fv,
          bandLo: r.lo,
          bandHi: r.hi,
          mark: r.mark,
          window: r.win,
        })),
      };
    },
  );

  app.get('/api/account', async (req, reply) => {
    const account = accountOf(req);
    if (account === undefined) return sendError(reply, 'unauthenticated', 'log in first');
    return (
      (await adapter.account(account)) ?? {
        account,
        seq: '0',
        cash: '0.000000',
        equity: '0.000000',
        maintenance: '0.000000',
        positions: [],
      }
    );
  });

  const execute = async (reply: FastifyReply, run: () => Promise<unknown>) => {
    try {
      return await run();
    } catch (err) {
      if (err instanceof ExecutionError) {
        if (err.code === 'timeout') return sendError(reply, 'timeout', err.message);
        if (err.code === 'unknown-market') return sendError(reply, 'not-found', err.message);
        if (err.code === 'invalid-size') return sendError(reply, 'bad-request', err.message);
        return sendError(reply, 'unavailable', err.message);
      }
      throw err;
    }
  };

  app.post('/api/orders', async (req, reply) => {
    const account = accountOf(req);
    if (account === undefined) return sendError(reply, 'unauthenticated', 'log in first');
    const body = orderBody.safeParse(req.body);
    if (!body.success)
      return sendError(
        reply,
        'bad-request',
        body.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      );
    const { limitPrice, ...rest } = body.data;
    return execute(reply, () =>
      adapter.placeOrder({ account, ...rest, ...(limitPrice === undefined ? {} : { limitPrice }) }),
    );
  });

  app.delete<{ Params: { id: string } }>('/api/orders/:id', async (req, reply) => {
    const account = accountOf(req);
    if (account === undefined) return sendError(reply, 'unauthenticated', 'log in first');
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(req.params.id))
      return sendError(reply, 'bad-request', 'invalid order id');
    return execute(reply, () => adapter.cancelOrder(account, req.params.id));
  });

  app.post<{ Params: { market: string } }>('/api/positions/:market/close', async (req, reply) => {
    const account = accountOf(req);
    if (account === undefined) return sendError(reply, 'unauthenticated', 'log in first');
    const body = closeBody.safeParse(req.body ?? {});
    if (!MARKET_ID.test(req.params.market) || !body.success)
      return sendError(reply, 'bad-request', 'invalid request');
    return execute(reply, () =>
      adapter.closePosition(account, req.params.market, body.data.idempotencyKey),
    );
  });

  registerSocket(app, deps, accountOf);
  app.log.info({ requestId: randomUUID() }, 'api routes registered');
}
