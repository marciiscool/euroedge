// Gasless faucet-claim and permit-deposit relayer for Base Sepolia (M5).
import { runService } from '@euroedge/service-kit';
import { loadConfig } from './config.ts';

const config = loadConfig();

await runService({ name: 'relayer', port: config.RELAYER_PORT, logLevel: config.LOG_LEVEL });
