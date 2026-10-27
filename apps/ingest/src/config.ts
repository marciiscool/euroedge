import { connectionEnv, loadEnv } from '@euroedge/shared/config';
import { z } from 'zod';

export const configShape = {
  ...connectionEnv,
  INGEST_PORT: z.coerce.number().int().min(0).max(65_535).default(4030),
  SIM_SEED: z.coerce.number().int().default(42),
  /** Sim world epoch (UTC ms). Default: the most recent Monday 00:00 UTC. */
  SIM_EPOCH: z.coerce.number().int().positive().optional(),
} as const;

export const loadConfig = (source?: Record<string, string | undefined>) =>
  loadEnv(configShape, source);

/** Most recent Monday 00:00 UTC at or before `now`. */
export function defaultSimEpoch(now: number): number {
  const day = 86_400_000;
  const midnight = Math.floor(now / day) * day;
  const weekday = (new Date(midnight).getUTCDay() + 6) % 7; // Monday = 0
  return midnight - weekday * day;
}
