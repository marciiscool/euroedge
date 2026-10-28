import { connectionEnv, loadEnv } from '@euroedge/shared/config';
import { z } from 'zod';

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);

export const configShape = {
  INDEXER_PORT: z.coerce.number().int().min(0).max(65_535).default(4050),
  DATABASE_URL: connectionEnv.DATABASE_URL.default(
    'postgres://euroedge:euroedge@localhost:5432/euroedge',
  ),
  VALKEY_URL: connectionEnv.VALKEY_URL.default('redis://localhost:6379'),
  /** Off until the contracts are deployed (M5-07); then the Vault and its deploy block. */
  INDEXER_ENABLED: z.stringbool().default(false),
  CHAIN_ID: z.coerce.number().int().positive().default(84532),
  BASE_SEPOLIA_RPC_URL: z.string().default(''),
  VAULT_ADDRESS: address.optional(),
  INDEXER_START_BLOCK: z.coerce.bigint().min(0n).default(0n),
  INDEXER_POLL_MS: z.coerce.number().int().min(250).default(4_000),
  /** Blocks per eth_getLogs. Alchemy's free tier allows 10; paid RPCs take thousands. */
  INDEXER_MAX_RANGE: z.coerce.bigint().min(1n).default(2_000n),
} as const;

export const loadConfig = (source?: Record<string, string | undefined>) => {
  const env = loadEnv(configShape, source);
  if (env.INDEXER_ENABLED && (env.BASE_SEPOLIA_RPC_URL === '' || env.VAULT_ADDRESS === undefined))
    throw new Error('INDEXER_ENABLED=true needs BASE_SEPOLIA_RPC_URL and VAULT_ADDRESS');
  return env;
};
