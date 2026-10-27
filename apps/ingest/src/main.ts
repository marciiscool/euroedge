// Market-data ingest: providers → normalized ticks → Timescale + Valkey (brief §4).
import { runService } from '@euroedge/service-kit';
import { loadConfig } from './config.ts';

const config = loadConfig();

await runService({ name: 'ingest', port: config.INGEST_PORT, logLevel: config.LOG_LEVEL });
