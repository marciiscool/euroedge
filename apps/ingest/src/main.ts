// Market-data ingest: providers → normalized ticks → Timescale + Valkey (brief §4).
import { migrate } from '@euroedge/db';
import { TradegateProvider } from '@euroedge/data-adapters';
import { createValkey, runService } from '@euroedge/service-kit';
import { CHANNELS, type Tick } from '@euroedge/shared';
import { loadMarkets, loadSimConfig } from '@euroedge/shared/config';
import { defaultSimEpoch, loadConfig } from './config.ts';
import { fastForward } from './sim-start.ts';
import { replaySource } from './replay-start.ts';
import { TickWriter } from './writer.ts';

const config = loadConfig();
if (config.DATA_TIER === 'live-min') {
  // Tradegate has no vendor yet and Pyth needs PYTH_API_KEY; both stubs refuse to start.
  new TradegateProvider().subscribe([], () => undefined);
}

let lastTickAt = 0;

await runService(
  {
    name: 'ingest',
    port: config.INGEST_PORT,
    logLevel: config.LOG_LEVEL,
    readiness: {
      ticks: () =>
        Date.now() - lastTickAt < 10_000
          ? Promise.resolve()
          : Promise.reject(new Error('no recent ticks')),
    },
  },
  async (service) => {
    await migrate(config.DATABASE_URL);
    const markets = (await loadMarkets()).filter((m) => m.enabled);
    const valkey = createValkey(config.VALKEY_URL, 'ingest');
    const writer = new TickWriter(config.DATABASE_URL);
    let advance: () => readonly Tick[];
    let initial: readonly Tick[];
    if (config.DATA_TIER === 'replay') {
      const r = await replaySource(config.REPLAY_FILE, config.REPLAY_SPEED);
      service.log.info(
        { file: config.REPLAY_FILE, speed: config.REPLAY_SPEED, ticks: r.count },
        'replay loaded',
      );
      initial = [];
      advance = r.advance;
    } else {
      const epoch = config.SIM_EPOCH ?? defaultSimEpoch(Date.now());
      const simConfig = await loadSimConfig();
      const { world, snapshot } = fastForward(
        config.SIM_SEED,
        epoch,
        Date.now(),
        markets,
        simConfig,
      );
      service.log.info(
        { epoch: new Date(epoch).toISOString(), seed: config.SIM_SEED, snapshot: snapshot.length },
        'sim world fast-forwarded',
      );
      initial = snapshot;
      advance = () => world.advanceTo(Date.now());
    }

    const emit = (ticks: readonly Tick[]) => {
      if (ticks.length === 0) return;
      const pipe = valkey.pipeline();
      for (const t of ticks) {
        if (!writer.push(t)) continue;
        pipe.publish(CHANNELS.ticks, JSON.stringify(t));
      }
      lastTickAt = Date.now();
      void pipe.exec();
    };
    emit(initial);
    const poll = setInterval(() => emit(advance()), 250);
    const flush = setInterval(() => {
      writer.flush().catch((err: unknown) => service.log.error({ err }, 'tick insert failed'));
    }, 1000);
    service.onShutdown(async () => {
      clearInterval(poll);
      clearInterval(flush);
      await writer.flush();
      await writer.close();
      valkey.disconnect();
    });
  },
);
