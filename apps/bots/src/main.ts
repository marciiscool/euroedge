// Simulated traders (M4-23/24): noise, momentum and mean-reversion bots in the sim tier.
import { Rng } from '@euroedge/data-adapters';
import { createValkey, runService } from '@euroedge/service-kit';
import { loadConfig } from './config.ts';
import { BotFleet, makeBots } from './fleet.ts';
import { arbitrageur, meanReversion, momentum, noise, whale } from './strategies.ts';
import { valkeyTransport } from './transport.ts';

const config = loadConfig();

await runService(
  { name: 'bots', port: config.BOTS_PORT, logLevel: config.LOG_LEVEL },
  async (service) => {
    if (!config.BOTS_ENABLED) {
      service.log.info('bots disabled (BOTS_ENABLED=false)');
      return;
    }
    const valkey = createValkey(config.VALKEY_URL, 'bots');
    const fleet = new BotFleet(
      // Mostly background flow; one whale and one arbitrageur per 50 bots.
      makeBots(config.BOTS_COUNT, [
        ...Array.from({ length: 16 }, () => [noise(), momentum(), meanReversion()]).flat(),
        whale(),
        arbitrageur(),
      ]),
      config.BOTS_MARKETS.split(',').map((m) => m.trim()),
      valkeyTransport(valkey, config.BOTS_FUND_USDC),
      new Rng(config.BOTS_SEED),
    );
    await fleet.fundAll();
    let busy = false;
    const timer = setInterval(() => {
      if (busy) return;
      busy = true;
      fleet
        .tick()
        .then((n) => service.log.debug({ orders: n }, 'bot tick'))
        .catch((err: unknown) => service.log.warn({ err }, 'bot tick failed'))
        .finally(() => (busy = false));
    }, config.BOTS_INTERVAL_MS);
    service.onShutdown(() => {
      clearInterval(timer);
      valkey.disconnect();
      return Promise.resolve();
    });
  },
);
