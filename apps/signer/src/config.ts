import { connectionEnv, loadEnv } from '@euroedge/shared/config';
import { z } from 'zod';

export const configShape = {
  SIGNER_PORT: z.coerce.number().int().min(0).max(65_535).default(4070),
  VALKEY_URL: connectionEnv.VALKEY_URL.default('redis://localhost:6379'),
  /** Off until the Vault is deployed (M5-07). */
  SIGNER_ENABLED: z.stringbool().default(false),
  CHAIN_ID: z.coerce.number().int().positive().default(84532),
  VAULT_ADDRESS: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/)
    .optional(),
  ENGINE_SIGNER_PRIVATE_KEY: z.string().default(''),
  /** Root poster (M5-12): its own key; off while empty. */
  ROOT_POSTER_PRIVATE_KEY: z.string().default(''),
  BALANCE_ROOT_ADDRESS: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/)
    .optional(),
  BASE_SEPOLIA_RPC_URL: z.string().default(''),
} as const;

export const loadConfig = (source?: Record<string, string | undefined>) => {
  const env = loadEnv(configShape, source);
  if (
    env.SIGNER_ENABLED &&
    (env.VAULT_ADDRESS === undefined || !/^0x[0-9a-fA-F]{64}$/.test(env.ENGINE_SIGNER_PRIVATE_KEY))
  )
    throw new Error('SIGNER_ENABLED=true needs VAULT_ADDRESS and ENGINE_SIGNER_PRIVATE_KEY');
  return env;
};
