// Engine signer (M5-08): EIP-712 withdrawal authorisations for what the engine reserved.
import { createValkey, runService } from '@euroedge/service-kit';
import { balanceSnapshotSchema, KEYS, STREAMS } from '@euroedge/shared';
import { loadConfig } from './config.ts';
import { parseRecord, signReservation, type SignerStore } from './service.ts';
import { localSigner } from './signer.ts';
import { postRoot, viemRootChain, type RootStore } from './poster.ts';

const config = loadConfig();

await runService(
  { name: 'signer', port: config.SIGNER_PORT, logLevel: config.LOG_LEVEL },
  (service) => {
    if (!config.SIGNER_ENABLED || config.VAULT_ADDRESS === undefined) {
      service.log.info('signer disabled (SIGNER_ENABLED=false)');
      return Promise.resolve();
    }
    const vault = config.VAULT_ADDRESS as `0x${string}`;
    const signer = localSigner(
      config.ENGINE_SIGNER_PRIVATE_KEY as `0x${string}`,
      config.CHAIN_ID,
      vault,
    );
    const valkey = createValkey(config.VALKEY_URL, 'signer');
    const reader = createValkey(config.VALKEY_URL, 'signer-reader');
    const store: SignerStore = {
      record: async (id) => parseRecord(await valkey.get(KEYS.withdrawal(id))),
      hasAuth: async (id) => (await valkey.exists(KEYS.withdrawalAuth(id))) === 1,
      saveAuth: async (a) => {
        await valkey.set(KEYS.withdrawalAuth(a.id), JSON.stringify(a));
      },
    };
    const sign = async (id: string) => {
      const r = await signReservation(store, signer, { chainId: config.CHAIN_ID, vault }, id);
      if (r === 'signed') service.log.info({ id }, 'withdrawal authorised');
    };
    service.log.info({ signer: signer.address }, 'engine signer ready');
    let stopping = false;
    const loop = (async () => {
      // Catch up on anything pending (restart), then follow the stream.
      for (const id of await valkey.smembers(KEYS.pendingWithdrawals)) await sign(id);
      let cursor = '$';
      while (!stopping) {
        const res = await reader
          .xread('COUNT', 100, 'BLOCK', 1_000, 'STREAMS', STREAMS.withdrawals, cursor)
          .catch(() => null);
        for (const [entryId, fields] of res?.[0]?.[1] ?? []) {
          cursor = entryId;
          const id = fields[fields.indexOf('id') + 1];
          if (id !== undefined)
            await sign(id).catch((err: unknown) =>
              service.log.error({ err, id }, 'signing failed'),
            );
        }
      }
    })();
    // Hourly balance roots (M5-12), if a poster key and the BalanceRoot address are set.
    const poster =
      /^0x[0-9a-fA-F]{64}$/.test(config.ROOT_POSTER_PRIVATE_KEY) &&
      config.BALANCE_ROOT_ADDRESS !== undefined
        ? viemRootChain(
            config.BASE_SEPOLIA_RPC_URL,
            config.ROOT_POSTER_PRIVATE_KEY as `0x${string}`,
            config.BALANCE_ROOT_ADDRESS as `0x${string}`,
          )
        : undefined;
    const rootReader = createValkey(config.VALKEY_URL, 'signer-roots');
    const roots: RootStore = {
      snapshot: async (hour) => {
        const raw = await valkey.get(KEYS.balanceSnapshot(hour));
        return raw === null ? undefined : balanceSnapshotSchema.parse(JSON.parse(raw));
      },
      posted: async (hour) => (await valkey.exists(KEYS.postedRoot(hour))) === 1,
      savePosted: async (p) => {
        await valkey.set(KEYS.postedRoot(p.hour), JSON.stringify(p));
      },
    };
    const rootLoop = (async () => {
      if (poster === undefined)
        return service.log.info('root poster disabled (no ROOT_POSTER_PRIVATE_KEY)');
      const post = async (hour: string) => {
        const r = await postRoot(roots, poster, hour);
        if (r === 'posted') service.log.info({ hour }, 'balance root posted');
      };
      const latest = await valkey.get(KEYS.latestBalanceHour);
      if (latest !== null)
        await post(latest).catch((err: unknown) => service.log.error({ err }, 'root post failed'));
      let cursor = '$';
      while (!stopping) {
        const res = await rootReader
          .xread('COUNT', 10, 'BLOCK', 1_000, 'STREAMS', STREAMS.balanceRoots, cursor)
          .catch(() => null);
        for (const [entryId, fields] of res?.[0]?.[1] ?? []) {
          cursor = entryId;
          const hour = fields[fields.indexOf('hour') + 1];
          if (hour !== undefined)
            await post(hour).catch((err: unknown) =>
              service.log.error({ err, hour }, 'root post failed'),
            );
        }
      }
    })();
    service.onShutdown(async () => {
      stopping = true;
      reader.disconnect();
      rootReader.disconnect();
      await loop.catch(() => undefined);
      await rootLoop.catch(() => undefined);
      valkey.disconnect();
    });
    return Promise.resolve();
  },
);
