import { loadEnv } from '@euroedge/shared/config';
import { z } from 'zod';

export const configShape = {
  BOTS_PORT: z.coerce.number().int().min(0).max(65_535).default(4060),
} as const;

export const loadConfig = (source?: Record<string, string | undefined>) =>
  loadEnv(configShape, source);
