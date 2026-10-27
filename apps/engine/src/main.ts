// Single-writer, event-sourced trading engine (ADR-0001). The deterministic core lives in src/core (M1).
import { runService } from '@euroedge/service-kit';
import { loadConfig } from './config.ts';

const config = loadConfig();

await runService({ name: 'engine', port: config.ENGINE_PORT, logLevel: config.LOG_LEVEL });
