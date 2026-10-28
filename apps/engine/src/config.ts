import { connectionEnv, loadEnv } from '@euroedge/shared/config';
import { z } from 'zod';

export const configShape = {
  ...connectionEnv,
  ENGINE_PORT: z.coerce.number().int().min(0).max(65_535).default(4010),
  /** State snapshot every N events (M4-19); 0 disables. */
  ENGINE_SNAPSHOT_EVERY: z.coerce.number().int().min(0).default(10_000),
  /**
   * Where genesis capital comes from (ADR-0013): `dev` = injected at bootstrap (sim/replay),
   * `chain` = only from the Vault's GenesisFunded via the indexer (M5-14, a deployed Vault).
   */
  GENESIS_SOURCE: z.enum(['dev', 'chain']).default('dev'),
} as const;

export const loadConfig = (source?: Record<string, string | undefined>) =>
  loadEnv(configShape, source);
