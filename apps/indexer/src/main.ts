// Vault event indexer at the `safe` block tag (M5-09): chain logs → engine inputs.
import pg from 'pg';
import { createValkey, runService } from '@euroedge/service-kit';
import {
  encodeEngineCommand,
  ENGINE_STREAM_MAXLEN,
  KEYS,
  STREAMS,
  withdrawalRecordSchema,
} from '@euroedge/shared';
import { viemReader } from './chain.ts';
import { loadConfig } from './config.ts';
import { pgCursor } from './cursor.ts';
import { checkExpiries } from './expiry.ts';
import { VaultIndexer } from './indexer.ts';

const config = loadConfig();

await runService(
  { name: 'indexer', port: config.INDEXER_PORT, logLevel: config.LOG_LEVEL },
  (service) => {
    if (!config.INDEXER_ENABLED || config.VAULT_ADDRESS === undefined) {
      service.log.info('indexer disabled (INDEXER_ENABLED=false)');
      return Promise.resolve();
    }
    const db = new pg.Pool({ connectionString: config.DATABASE_URL, max: 2 });
    const valkey = createValkey(config.VALKEY_URL, 'indexer');
    const reader = viemReader(config.BASE_SEPOLIA_RPC_URL, config.VAULT_ADDRESS as `0x${string}`);
    const sink = async (input: Record<string, unknown>) => {
      await valkey.xadd(
        STREAMS.engineInput,
        'MAXLEN',
        '~',
        String(ENGINE_STREAM_MAXLEN),
        '*',
        'input',
        encodeEngineCommand(input),
      );
    };
    const indexer = new VaultIndexer({
      reader,
      cursor: pgCursor(db, config.CHAIN_ID),
      sink,
      startBlock: config.INDEXER_START_BLOCK,
      maxRange: config.INDEXER_MAX_RANGE,
    });
    // Pending withdrawals as the engine published them (M5-10).
    const pending = async () => {
      const ids = await valkey.smembers(KEYS.pendingWithdrawals);
      const raw = ids.length === 0 ? [] : await valkey.mget(ids.map((id) => KEYS.withdrawal(id)));
      return raw.flatMap((r) => (r === null ? [] : [withdrawalRecordSchema.parse(JSON.parse(r))]));
    };
    let busy = false;
    const timer = setInterval(() => {
      if (busy) return;
      busy = true;
      indexer
        .catchUp(50)
        .then(async (n) => {
          if (n > 0) service.log.info({ logs: n }, 'vault logs forwarded');
          const expired = await checkExpiries(await pending(), reader, sink);
          if (expired > 0) service.log.info({ expired }, 'expired withdrawals sent for re-credit');
        })
        .catch((err: unknown) => service.log.warn({ err }, 'indexer step failed; retrying'))
        .finally(() => (busy = false));
    }, config.INDEXER_POLL_MS);
    service.onShutdown(async () => {
      clearInterval(timer);
      valkey.disconnect();
      await db.end();
    });
    return Promise.resolve();
  },
);
