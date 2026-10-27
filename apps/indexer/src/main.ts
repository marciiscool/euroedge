// Vault event indexer at the `safe` block tag, reorg-safe (M5).
import { runService } from '@euroedge/service-kit';
import { loadConfig } from './config.ts';

const config = loadConfig();

await runService({ name: 'indexer', port: config.INDEXER_PORT, logLevel: config.LOG_LEVEL });
