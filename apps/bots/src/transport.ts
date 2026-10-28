import type { Redis } from '@euroedge/service-kit';
import {
  accountSnapshotSchema,
  encodeEngineCommand,
  ENGINE_STREAM_MAXLEN,
  KEYS,
  marketSnapshotSchema,
  STREAMS,
} from '@euroedge/shared';
import type { BotTransport } from './fleet.ts';

/**
 * Interim transport (sim tier only): reads the engine's hot state from Valkey and enqueues
 * inputs on the engine stream, as the API does. Replaced by the HMAC API client in M6-03.
 */
export function valkeyTransport(valkey: Redis, fundUsdc: number): BotTransport {
  const lotSize = new Map<string, number>();
  const enqueue = (input: unknown) =>
    valkey.xadd(
      STREAMS.engineInput,
      'MAXLEN',
      '~',
      String(ENGINE_STREAM_MAXLEN),
      '*',
      'input',
      encodeEngineCommand(input),
    );
  return {
    async quote(market) {
      const raw = await valkey.get(KEYS.market(market));
      if (raw === null) return undefined;
      const m = marketSnapshotSchema.parse(JSON.parse(raw));
      lotSize.set(market, Number(m.lotSize));
      return { mark: Number(m.mark), fv: Number(m.fv), bid: Number(m.bid), ask: Number(m.ask) };
    },
    async position(account, market) {
      const raw = await valkey.get(KEYS.account(account));
      if (raw === null) return 0n;
      const p = accountSnapshotSchema
        .parse(JSON.parse(raw))
        .positions.find((x) => x.market === market);
      const lot = lotSize.get(market) ?? 0.01;
      return p === undefined ? 0n : BigInt(Math.round(Number(p.size) / lot));
    },
    async fund(account) {
      if ((await valkey.set(`bots:funded:${account}`, '1', 'NX')) !== 'OK') return;
      await enqueue({ type: 'DevDeposit', account, amount: BigInt(fundUsdc) * 1_000_000n });
    },
    async place(account, market, intent, requestId) {
      await enqueue({
        type: 'PlaceOrder',
        requestId,
        idempotencyKey: requestId,
        account,
        market,
        side: intent.side,
        qty: intent.lots,
        reduceOnly: intent.reduceOnly,
      });
    },
  };
}
