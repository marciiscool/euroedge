import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import type { LevelWithSilent } from 'pino';
import { createLogger, type Logger } from './logger.ts';

export type ReadinessCheck = () => Promise<void>;
export type ShutdownHook = () => Promise<void>;

export interface ServiceOptions {
  readonly name: string;
  readonly port: number;
  readonly host?: string;
  readonly logLevel?: LevelWithSilent;
  /** Named checks behind GET /ready (e.g. database, valkey). Throw to report not ready. */
  readonly readiness?: Readonly<Record<string, ReadinessCheck>>;
  /** Max time for shutdown hooks before the process exits anyway. */
  readonly shutdownTimeoutMs?: number;
}

export interface Service {
  readonly name: string;
  readonly log: Logger;
  readonly http: FastifyInstance;
  /** Registers cleanup run on shutdown, in reverse registration order. */
  onShutdown(hook: ShutdownHook): void;
  listen(): Promise<string>;
  close(): Promise<void>;
}

/**
 * Builds a service shell: pino logger, Fastify with /health (liveness) and /ready
 * (readiness), and ordered shutdown hooks. Business routes are added on `http`.
 */
export function createService(opts: ServiceOptions): Service {
  const log = createLogger(opts.name, opts.logLevel);
  const http: FastifyInstance = Fastify({
    // Widen pino's Logger so Fastify keeps its default logger generic (tsc needs this under
    // exactOptionalPropertyTypes even though typescript-eslint considers it redundant).
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    loggerInstance: log as FastifyBaseLogger,
    disableRequestLogging: true,
  });
  const hooks: ShutdownHook[] = [];
  const startedAt = Date.now();
  let closing = false;

  http.get('/health', () => ({
    status: 'ok',
    service: opts.name,
    uptimeMs: Date.now() - startedAt,
  }));

  http.get('/ready', async (_req, reply) => {
    const results: Record<string, string> = {};
    let ready = !closing;
    for (const [name, check] of Object.entries(opts.readiness ?? {})) {
      try {
        await check();
        results[name] = 'ok';
      } catch (err) {
        ready = false;
        results[name] = err instanceof Error ? err.message : String(err);
      }
    }
    return reply
      .code(ready ? 200 : 503)
      .send({ status: ready ? 'ready' : 'not-ready', service: opts.name, checks: results });
  });

  const close = async (): Promise<void> => {
    if (closing) return;
    closing = true;
    await http.close();
    for (const hook of [...hooks].reverse()) {
      try {
        await hook();
      } catch (err) {
        log.error({ err }, 'shutdown hook failed');
      }
    }
  };

  return {
    name: opts.name,
    log,
    http,
    onShutdown: (hook) => void hooks.push(hook),
    listen: () => http.listen({ port: opts.port, host: opts.host ?? '0.0.0.0' }),
    close,
  };
}

/**
 * Starts a service and wires SIGINT/SIGTERM to a graceful shutdown with a hard timeout.
 * Intended for `main.ts` entry points only.
 */
export async function runService(opts: ServiceOptions, setup?: (s: Service) => Promise<void>) {
  const service = createService(opts);
  await setup?.(service);
  const address = await service.listen();
  service.log.info({ address }, `${opts.name} started`);

  const shutdown = (signal: string) => {
    service.log.info({ signal }, `${opts.name} shutting down`);
    const timer = setTimeout(() => {
      service.log.error('shutdown timed out; exiting');
      process.exit(1);
    }, opts.shutdownTimeoutMs ?? 10_000);
    timer.unref();
    service.close().then(
      () => process.exit(0),
      (err: unknown) => {
        service.log.error({ err }, 'shutdown failed');
        process.exit(1);
      },
    );
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  return service;
}
