import { connectionEnv, loadEnv } from '@euroedge/shared/config';
import { z } from 'zod';

const DEV_SECRET = 'dev-only-session-secret-not-for-deployment-000';

export const configShape = {
  ...connectionEnv,
  API_PORT: z.coerce.number().int().min(0).max(65_535).default(4000),
  /** The single origin users load (Caddy, ADR-0012); mutating requests must come from it. */
  PUBLIC_ORIGIN: z.url().default('http://localhost:8080'),
  /** Cookie-signing secret (≥ 32 chars). A fixed dev default is allowed only in local/ci. */
  SESSION_SECRET: z.string().default(''),
  /** Play money credited once per dev account. */
  DEV_FAUCET_USDC: z.coerce.number().int().positive().default(10_000),
  /** SIWE binding (M6-01): chain, and the domain; empty = the host of PUBLIC_ORIGIN. */
  CHAIN_ID: z.coerce.number().int().positive().default(84532),
  SIWE_DOMAIN: z.string().default(''),
  /** Enables ERC-1271/6492 smart-wallet sign-in; without it only EOAs verify. */
  BASE_SEPOLIA_RPC_URL: z.string().default(''),
  /** Deployed contracts (M5-07); the web app reads them from GET /api/chain. Empty = no chain yet. */
  TOKEN_ADDRESS: z.string().default(''),
  VAULT_ADDRESS: z.string().default(''),
} as const;

export type ApiConfig = ReturnType<typeof loadConfig>;

export function loadConfig(source?: Record<string, string | undefined>) {
  const env = loadEnv(configShape, source);
  const deployed = env.DEPLOY_ENV !== 'local' && env.DEPLOY_ENV !== 'ci';
  if (env.SESSION_SECRET.length > 0 && env.SESSION_SECRET.length < 32) {
    throw new Error('SESSION_SECRET must be at least 32 characters');
  }
  if (env.SESSION_SECRET === '' && deployed)
    throw new Error('SESSION_SECRET is required in deployed builds');
  return { ...env, SESSION_SECRET: env.SESSION_SECRET === '' ? DEV_SECRET : env.SESSION_SECRET };
}
