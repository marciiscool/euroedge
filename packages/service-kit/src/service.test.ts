import { describe, expect, it } from 'vitest';
import { createService } from './service.ts';

const make = (readiness?: Record<string, () => Promise<void>>) =>
  createService({
    name: 'probe',
    port: 0,
    logLevel: 'silent',
    ...(readiness ? { readiness } : {}),
  });

describe('createService', () => {
  it('serves /health', async () => {
    const s = make();
    const res = await s.http.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', service: 'probe' });
    await s.close();
  });

  it('reports readiness per check', async () => {
    const s = make({
      db: async () => {},
      valkey: async () => Promise.reject(new Error('connection refused')),
    });
    const res = await s.http.inject({ method: 'GET', url: '/ready' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({
      status: 'not-ready',
      service: 'probe',
      checks: { db: 'ok', valkey: 'connection refused' },
    });
    await s.close();
  });

  it('is ready with no checks', async () => {
    const s = make();
    expect((await s.http.inject({ method: 'GET', url: '/ready' })).statusCode).toBe(200);
    await s.close();
  });

  it('runs shutdown hooks in reverse order, once, even if one fails', async () => {
    const s = make();
    const calls: string[] = [];
    s.onShutdown(() => Promise.resolve(void calls.push('first')));
    s.onShutdown(async () => Promise.reject(new Error('boom')));
    s.onShutdown(() => Promise.resolve(void calls.push('third')));
    await s.close();
    await s.close();
    expect(calls).toEqual(['third', 'first']);
  });

  it('listens on an ephemeral port', async () => {
    const s = make();
    const address = await s.listen();
    expect(address).toMatch(/^http:\/\//);
    const res = await fetch(`${address}/health`);
    expect(res.status).toBe(200);
    await s.close();
  });
});
