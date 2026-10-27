// Fair-value service: runs fv-core every 1 s per market (brief §6).
import { runService } from '@euroedge/service-kit';
import { loadFvParams, loadMarkets, loadWindows } from '@euroedge/shared/config';
import { loadConfig } from './config.ts';
import { startFvService, type RunningFvService } from './service.ts';

const config = loadConfig();
let fv: RunningFvService | undefined;

await runService(
  {
    name: 'fv-service',
    port: config.FV_SERVICE_PORT,
    logLevel: config.LOG_LEVEL,
    readiness: {
      publishing: () =>
        fv !== undefined && Date.now() - fv.lastPublishAt() < 5_000
          ? Promise.resolve()
          : Promise.reject(new Error('no FV published in the last 5 s')),
    },
  },
  async (service) => {
    const catalog = await loadMarkets();
    fv = await startFvService({
      databaseUrl: config.DATABASE_URL,
      valkeyUrl: config.VALKEY_URL,
      markets: catalog.filter((m) => m.enabled),
      catalog,
      params: await loadFvParams(),
      stepCapBpsPerSecond: (await loadWindows()).markStepCapBpsPerSecond,
      log: service.log,
    });
    const running = fv;
    service.onShutdown(() => running.stop());
  },
);
