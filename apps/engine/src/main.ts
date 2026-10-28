// Single-writer, event-sourced trading engine (ADR-0001). The deterministic core lives in src/core.
import { runService } from '@euroedge/service-kit';
import { loadMarkets, loadWindows } from '@euroedge/shared/config';
import { loadConfig } from './config.ts';
import { startEngine } from './engine.ts';

const config = loadConfig();
let healthy = false;

await runService(
  {
    name: 'engine',
    port: config.ENGINE_PORT,
    logLevel: config.LOG_LEVEL,
    readiness: {
      engine: () => (healthy ? Promise.resolve() : Promise.reject(new Error('not ready'))),
    },
  },
  async (service) => {
    const engine = await startEngine({
      databaseUrl: config.DATABASE_URL,
      valkeyUrl: config.VALKEY_URL,
      tier: config.DATA_TIER,
      markets: await loadMarkets(),
      windows: await loadWindows(),
      log: service.log,
      snapshotEvery: config.ENGINE_SNAPSHOT_EVERY,
      genesisSource: config.GENESIS_SOURCE,
    });
    healthy = true;
    service.onShutdown(() => engine.stop());
  },
);
