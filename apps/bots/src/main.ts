// Simulated traders for load and adversarial testing (M4).
import { runService } from '@euroedge/service-kit';
import { loadConfig } from './config.ts';

const config = loadConfig();

await runService({ name: 'bots', port: config.BOTS_PORT, logLevel: config.LOG_LEVEL });
