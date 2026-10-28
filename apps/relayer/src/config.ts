import { connectionEnv, loadEnv } from '@euroedge/shared/config';
import { z } from 'zod';

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);

export const configShape = {
  RELAYER_PORT: z.coerce.number().int().min(0).max(65_535).default(4040),
  VALKEY_URL: connectionEnv.VALKEY_URL.default('redis://localhost:6379'),
  PUBLIC_ORIGIN: z.url().default('http://localhost:8080'),
  /** Off until the contracts are deployed (M5-07). */
  RELAYER_ENABLED: z.stringbool().default(false),
  BASE_SEPOLIA_RPC_URL: z.string().default(''),
  RELAYER_PRIVATE_KEY: z.string().default(''),
  TOKEN_ADDRESS: address.optional(),
  VAULT_ADDRESS: address.optional(),
  /** Warn below this much ETH (gas for roughly a few hundred relays on Base Sepolia). */
  RELAYER_MIN_ETH: z.coerce.number().positive().default(0.05),
} as const;

export const loadConfig = (source?: Record<string, string | undefined>) => {
  const env = loadEnv(configShape, source);
  if (
    env.RELAYER_ENABLED &&
    (env.BASE_SEPOLIA_RPC_URL === '' ||
      !/^0x[0-9a-fA-F]{64}$/.test(env.RELAYER_PRIVATE_KEY) ||
      env.TOKEN_ADDRESS === undefined ||
      env.VAULT_ADDRESS === undefined)
  )
    throw new Error(
      'RELAYER_ENABLED=true needs BASE_SEPOLIA_RPC_URL, RELAYER_PRIVATE_KEY, TOKEN_ADDRESS, VAULT_ADDRESS',
    );
  return env;
};
