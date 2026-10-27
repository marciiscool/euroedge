import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { WebSocket } from 'ws';
import { CHANNELS, KEYS } from '@euroedge/shared';
import type { ApiDeps } from './app.ts';

/**
 * WebSocket gateway v0 (brief §9; seq/gap/resync protocol arrives in M6). Clients send
 * {"op":"sub","ch":"market:ASML-PERP" | "fv:ASML-PERP" | "account"}; the server replies with a
 * snapshot, then forwards updates as {"ch", "data"}. `account` is bound to the session cookie.
 */
export function registerSocket(
  app: FastifyInstance,
  deps: ApiDeps,
  accountOf: (req: FastifyRequest) => string | undefined,
) {
  const { subscriber, valkey, config } = deps;
  const listeners = new Map<string, Set<WebSocket>>();

  subscriber.on('message', (channel: string, msg: string) => {
    for (const ws of listeners.get(channel) ?? [])
      ws.send(`{"ch":${JSON.stringify(channel)},"data":${msg}}`);
  });

  const add = async (channel: string, ws: WebSocket) => {
    let set = listeners.get(channel);
    if (set === undefined) {
      set = new Set();
      listeners.set(channel, set);
      await subscriber.subscribe(channel);
    }
    set.add(ws);
  };
  const remove = (ws: WebSocket) => {
    for (const [channel, set] of listeners) {
      if (set.delete(ws) && set.size === 0) {
        listeners.delete(channel);
        subscriber.unsubscribe(channel).catch(() => undefined);
      }
    }
  };

  app.get('/ws', { websocket: true }, (socket, req) => {
    if (req.headers.origin !== config.PUBLIC_ORIGIN) {
      socket.close(1008, 'origin not allowed');
      return;
    }
    const account = accountOf(req);
    socket.on('message', (raw: Buffer) => {
      let msg: { op?: unknown; ch?: unknown };
      try {
        msg = JSON.parse(raw.toString()) as typeof msg;
      } catch {
        return;
      }
      if (msg.op !== 'sub' || typeof msg.ch !== 'string') return;
      const [kind, id] = msg.ch.split(':');
      let channel: string;
      let key: string;
      if (kind === 'market' && id !== undefined && /^[A-Z0-9]+-PERP$/.test(id)) {
        channel = CHANNELS.market(id);
        key = KEYS.market(id);
      } else if (kind === 'fv' && id !== undefined && /^[A-Z0-9]+-PERP$/.test(id)) {
        channel = CHANNELS.fv(id);
        key = KEYS.fv(id);
      } else if (msg.ch === 'account' && account !== undefined) {
        // Only the caller's own account, bound to the session cookie — never by id.
        channel = CHANNELS.account(account);
        key = KEYS.account(account);
      } else {
        socket.send(
          JSON.stringify({
            error: { code: 'bad-channel', message: `cannot subscribe to ${msg.ch}` },
          }),
        );
        return;
      }
      void (async () => {
        await add(channel, socket);
        const snap = await valkey.get(key);
        if (snap !== null)
          socket.send(`{"ch":${JSON.stringify(channel)},"data":${snap},"snapshot":true}`);
      })().catch((err: unknown) => app.log.warn({ err }, 'ws subscribe failed'));
    });
    socket.on('close', () => remove(socket));
  });
}
