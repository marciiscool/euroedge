// REST + WebSocket gateway behind Caddy (ADR-0012); SIWE auth arrives in M6.
import { runService } from '@euroedge/service-kit';
import { loadConfig } from './config.ts';

const config = loadConfig();

await runService({ name: 'api', port: config.API_PORT, logLevel: config.LOG_LEVEL });
