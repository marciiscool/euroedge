import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createValkey, type Redis } from '@euroedge/service-kit';
import { CHANNELS, KEYS, STREAMS } from '@euroedge/shared';
import { ExecutionError } from './adapter.ts';
import { SimAdapter } from './sim-adapter.ts';
import { partnerAdapterStub } from './stubs.ts';

const vkUrl = process.env['VALKEY_URL'];

// A fake engine answers commands from the stream, so the adapter is tested in isolation.
describe.skipIf(vkUrl === undefined)('SimAdapter (integration with Valkey)', () => {
  const url = `${vkUrl ?? ''}/5`;
  let valkey: Redis;
  let sub: Redis;
  let engine: Redis;
  let stop = false;
  let loop: Promise<void> = Promise.resolve();

  beforeAll(async () => {
    valkey = createValkey(url, 'a');
    sub = createValkey(url, 'b');
    engine = createValkey(url, 'fake-engine');
    await valkey.flushdb();
    await valkey.set(
      KEYS.market('ASML-PERP'),
      JSON.stringify({
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
      }),
    );
    let cursor = '0-0';
    loop = (async () => {
      while (!stop) {
        const res = await engine.xread('BLOCK', 200, 'STREAMS', STREAMS.engineInput, cursor);
        for (const [id, fields] of res?.[0]?.[1] ?? []) {
          cursor = id;
          const cmd = JSON.parse(fields[1] ?? '{}') as {
            requestId: string;
            qty?: string;
            type: string;
          };
          const reply =
            cmd.type === 'PlaceOrder' && cmd.qty === '150'
              ? {
                  requestId: cmd.requestId,
                  seq: '9',
                  status: 'filled',
                  duplicate: false,
                  fill: {
                    market: 'ASML-PERP',
                    side: 'buy',
                    size: '1.50',
                    price: '700.35',
                    fee: '0.525263',
                    realized: '0.000000',
                  },
                }
              : {
                  requestId: cmd.requestId,
                  seq: '9',
                  status: 'rejected',
                  duplicate: false,
                  reason: 'no-position',
                };
          await engine.publish(CHANNELS.results, JSON.stringify(reply));
        }
      }
    })();
  });

  afterAll(async () => {
    stop = true;
    await loop; // the fake engine's XREAD BLOCK returns within 200 ms
    for (const c of [valkey, sub, engine]) c.disconnect();
  });

  it('converts decimal size to lots, round-trips a fill and streams it', async () => {
    const a = new SimAdapter({ valkey, subscriber: sub });
    const fills: unknown[] = [];
    a.streamFills((f) => fills.push(f));
    const ack = await a.placeOrder({
      account: 'x',
      market: 'ASML-PERP',
      side: 'buy',
      size: '1.50',
      type: 'market',
      reduceOnly: false,
      idempotencyKey: 'k',
    });
    expect(ack).toMatchObject({ status: 'filled', fill: { size: '1.50', price: '700.35' } });
    expect(fills).toHaveLength(1);
    expect(await a.closePosition('x', 'ASML-PERP', 'c')).toMatchObject({
      status: 'rejected',
      reason: 'no-position',
    });
  });

  it('rejects bad sizes and unknown markets before reaching the engine', async () => {
    const a = new SimAdapter({ valkey, subscriber: sub });
    const req = {
      account: 'x',
      side: 'buy' as const,
      type: 'market' as const,
      reduceOnly: false,
      idempotencyKey: 'k2',
    };
    await expect(
      a.placeOrder({ ...req, market: 'ASML-PERP', size: '0.005' }),
    ).rejects.toMatchObject({ code: 'invalid-size' });
    await expect(a.placeOrder({ ...req, market: 'NOPE-PERP', size: '1' })).rejects.toBeInstanceOf(
      ExecutionError,
    );
    await expect(a.cancelOrder('o1')).rejects.toMatchObject({ code: 'not-supported' });
    expect(await a.positions('nobody')).toEqual([]);
  });

  it('times out when the engine does not answer', async () => {
    const silent = createValkey(`${vkUrl ?? ''}/4`, 'silent');
    const silentSub = createValkey(`${vkUrl ?? ''}/4`, 'silent-sub');
    await silent.set(KEYS.market('ASML-PERP'), (await valkey.get(KEYS.market('ASML-PERP'))) ?? '');
    const a = new SimAdapter({ valkey: silent, subscriber: silentSub, timeoutMs: 300 });
    await expect(a.closePosition('x', 'ASML-PERP', 'k')).rejects.toMatchObject({ code: 'timeout' });
    silent.disconnect();
    silentSub.disconnect();
  });

  it('stubs for step 2/3 compile against the same contract and refuse politely', async () => {
    await expect(partnerAdapterStub.positions('x')).rejects.toMatchObject({
      code: 'not-supported',
    });
  });
});
