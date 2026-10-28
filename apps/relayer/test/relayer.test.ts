import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { registerRelay } from '../src/app.ts';
import type { RateLimiter, RelayChain } from '../src/relay.ts';

const ORIGIN = 'http://localhost:8080';
const USER = '0x00000000000000000000000000000000000a11ce';
const SIG = `0x${'11'.repeat(65)}`;

function memoryLimiter(): RateLimiter {
  const n = new Map<string, number>();
  return {
    hit: (key, max) => {
      n.set(key, (n.get(key) ?? 0) + 1);
      return Promise.resolve((n.get(key) ?? 0) <= max);
    },
  };
}

function app(simulateOk = true) {
  const sent: string[] = [];
  const chain: RelayChain = {
    simulate: () =>
      Promise.resolve(simulateOk ? { ok: true } : { ok: false, reason: 'ClaimCapExceeded' }),
    send: (kind) => {
      sent.push(kind);
      return Promise.resolve(`0x${'ab'.repeat(32)}` as const);
    },
  };
  const a = Fastify();
  registerRelay(a, {
    chain,
    limiter: memoryLimiter(),
    limits: { perWallet: 2, perIp: 3, windowSec: 3600 },
    origin: ORIGIN,
  });
  const post = (path: string, payload: object, origin = ORIGIN, ip = '1.1.1.1') =>
    a.inject({
      method: 'POST',
      url: path,
      payload,
      headers: { origin, 'x-forwarded-for': ip },
      remoteAddress: ip,
    });
  return { post, sent };
}

const req = (user = USER) => ({ user, amount: '1000000', deadline: '1900000000', signature: SIG });

describe('relayer (M5-11)', () => {
  it('relays a valid claim and a valid deposit', async () => {
    const { post, sent } = app();
    const c = await post('/relay/claim', req());
    expect(c.statusCode).toBe(200);
    expect(c.json()).toEqual({ txHash: `0x${'ab'.repeat(32)}` });
    expect((await post('/relay/deposit', req())).statusCode).toBe(200);
    expect(sent).toEqual(['claim', 'deposit']);
  });

  it('never pays for a transaction that would revert', async () => {
    const { post, sent } = app(false);
    const r = await post('/relay/claim', req());
    expect(r.statusCode).toBe(400);
    expect(r.json()).toMatchObject({ error: { code: 'rejected', message: 'ClaimCapExceeded' } });
    expect(sent).toEqual([]);
  });

  it('rate-limits per wallet and per IP', async () => {
    const { post } = app();
    await post('/relay/claim', req());
    await post('/relay/claim', req());
    expect((await post('/relay/claim', req())).statusCode).toBe(429); // 3rd for this wallet
    const other = (i: number) => req(`0x${String(i).padStart(40, '0')}`);
    expect((await post('/relay/claim', other(1))).statusCode).toBe(429); // 4th from this IP
    expect((await post('/relay/claim', other(2), ORIGIN, '2.2.2.2')).statusCode).toBe(200);
  });

  it('refuses cross-origin and malformed requests', async () => {
    const { post } = app();
    expect((await post('/relay/claim', req(), 'https://evil.example')).statusCode).toBe(403);
    expect((await post('/relay/claim', { ...req(), amount: '-1' })).statusCode).toBe(400);
    expect((await post('/relay/claim', { ...req(), user: 'alice' })).statusCode).toBe(400);
  });
});
