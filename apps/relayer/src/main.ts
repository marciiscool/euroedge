// Gasless claim / deposit relayer (M5-11): submits user-signed claimFor and depositWithPermit.
import { createValkey, runService } from '@euroedge/service-kit';
import { registerRelay } from './app.ts';
import { viemRelayChain } from './chain.ts';
import { loadConfig } from './config.ts';
import { DEFAULT_LIMITS, type RateLimiter } from './relay.ts';

const config = loadConfig();

await runService(
  { name: 'relayer', port: config.RELAYER_PORT, logLevel: config.LOG_LEVEL },
  (service) => {
    if (
      !config.RELAYER_ENABLED ||
      config.TOKEN_ADDRESS === undefined ||
      config.VAULT_ADDRESS === undefined
    ) {
      service.log.info('relayer disabled (RELAYER_ENABLED=false)');
      return Promise.resolve();
    }
    const valkey = createValkey(config.VALKEY_URL, 'relayer');
    const limiter: RateLimiter = {
      async hit(key, max, windowSec) {
        const n = await valkey.incr(key);
        if (n === 1) await valkey.expire(key, windowSec);
        return n <= max;
      },
    };
    const { chain, address, balance } = viemRelayChain({
      rpcUrl: config.BASE_SEPOLIA_RPC_URL,
      privateKey: config.RELAYER_PRIVATE_KEY as `0x${string}`,
      token: config.TOKEN_ADDRESS as `0x${string}`,
      vault: config.VAULT_ADDRESS as `0x${string}`,
    });
    registerRelay(service.http, {
      chain,
      limiter,
      limits: DEFAULT_LIMITS,
      origin: config.PUBLIC_ORIGIN,
    });
    const check = () =>
      balance()
        .then((eth) => {
          if (Number(eth) < config.RELAYER_MIN_ETH)
            service.log.warn({ address, eth }, 'relayer ETH low: top up');
        })
        .catch((err: unknown) => service.log.warn({ err }, 'relayer balance check failed'));
    void check();
    const timer = setInterval(() => void check(), 5 * 60_000);
    service.onShutdown(() => {
      clearInterval(timer);
      valkey.disconnect();
      return Promise.resolve();
    });
    return Promise.resolve();
  },
);
