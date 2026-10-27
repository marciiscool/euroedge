// REST + WebSocket gateway behind Caddy (ADR-0012). Talks to venues only via ExecutionAdapter.
import pg from 'pg';
import { SimAdapter } from '@euroedge/execution';
import { createValkey, runService } from '@euroedge/service-kit';
import { buildApi } from './app.ts';
import { loadConfig } from './config.ts';

const config = loadConfig();

await runService(
  {
    name: 'api',
    port: config.API_PORT,
    logLevel: config.LOG_LEVEL,
  },
  async (service) => {
    const valkey = createValkey(config.VALKEY_URL, 'api');
    const results = createValkey(config.VALKEY_URL, 'api-results');
    const subscriber = createValkey(config.VALKEY_URL, 'api-ws');
    const db = new pg.Pool({ connectionString: config.DATABASE_URL, max: 5 });
    const adapter = new SimAdapter({ valkey, subscriber: results });
    await buildApi(service.http, { adapter, valkey, subscriber, db, config });
    service.onShutdown(async () => {
      for (const c of [valkey, results, subscriber]) c.disconnect();
      await db.end();
    });
  },
);
