import { loadEnv } from '@euroedge/shared/config';
import { z } from 'zod';

export const configShape = {
  INGEST_PORT: z.coerce.number().int().min(0).max(65_535).default(4030),
} as const;

export const loadConfig = (source?: Record<string, string | undefined>) =>
  loadEnv(configShape, source);
