import { connectionEnv, loadEnv } from '@euroedge/shared/config';
import { z } from 'zod';

export const configShape = {
  BOTS_PORT: z.coerce.number().int().min(0).max(65_535).default(4060),
  VALKEY_URL: connectionEnv.VALKEY_URL.default('redis://localhost:6379'),
  /** Off by default: bots only trade when asked to, and only in the sim tier. */
  BOTS_ENABLED: z.stringbool().default(false),
  BOTS_COUNT: z.coerce.number().int().min(1).max(1_000).default(200),
  BOTS_INTERVAL_MS: z.coerce.number().int().min(100).default(2_000),
  BOTS_SEED: z.coerce.number().int().default(7),
  BOTS_MARKETS: z.string().default('ASML-PERP'),
  BOTS_FUND_USDC: z.coerce.number().int().positive().default(10_000),
} as const;

export const loadConfig = (source?: Record<string, string | undefined>) => {
  const env = loadEnv(configShape, source);
  if (env.BOTS_ENABLED && env.DATA_TIER !== 'sim')
    throw new Error(`BOTS_ENABLED=true requires DATA_TIER=sim (got ${env.DATA_TIER})`);
  return env;
};
