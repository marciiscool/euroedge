// Fair-value service: runs fv-core every 1 s and on relevant ticks (brief §6).
import { runService } from '@euroedge/service-kit';
import { loadConfig } from './config.ts';

const config = loadConfig();

await runService({ name: 'fv-service', port: config.FV_SERVICE_PORT, logLevel: config.LOG_LEVEL });
