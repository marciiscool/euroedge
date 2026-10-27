import { z } from 'zod';
import { dataTierSchema } from '../data-tier.ts';
import { ConfigError } from './errors.ts';

export const deployEnvSchema = z.enum(['local', 'ci', 'staging', 'production']);
export type DeployEnv = z.infer<typeof deployEnvSchema>;

/** Variables every process understands. Services extend this with their own. */
export const baseEnvShape = {
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /** Where this build runs. Anything but local/ci counts as a deployed build. */
  DEPLOY_ENV: deployEnvSchema.default('local'),
  DATA_TIER: dataTierSchema.default('sim'),
  /** Wallet-less dev login (M1). Only legal with DATA_TIER=sim in local/ci. */
  DEV_LOGIN: z.stringbool().default(false),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
} as const;

type BaseEnv = z.infer<z.ZodObject<typeof baseEnvShape>>;

/**
 * Cross-field guards. Founder rule (2026-10-27): DEV_LOGIN=true is refused unless
 * DATA_TIER=sim, and it never runs in a deployed build.
 */
export function envGuardViolations(env: Pick<BaseEnv, 'DEV_LOGIN' | 'DATA_TIER' | 'DEPLOY_ENV'>) {
  const violations: string[] = [];
  if (env.DEV_LOGIN && env.DATA_TIER !== 'sim') {
    violations.push(`DEV_LOGIN=true requires DATA_TIER=sim (got ${env.DATA_TIER})`);
  }
  if (env.DEV_LOGIN && env.DEPLOY_ENV !== 'local' && env.DEPLOY_ENV !== 'ci') {
    violations.push(
      `DEV_LOGIN=true is forbidden in deployed builds (DEPLOY_ENV=${env.DEPLOY_ENV})`,
    );
  }
  return violations;
}

export type Env<S extends z.ZodRawShape> = BaseEnv & z.infer<z.ZodObject<S>>;

/**
 * Parses and validates environment variables (12-factor). Throws ConfigError listing every
 * problem at once, so a misconfigured service fails fast at start-up.
 */
export function loadEnv<S extends z.ZodRawShape>(
  extra: S,
  source: Record<string, string | undefined> = process.env,
): Env<S> {
  const schema = z.object({ ...baseEnvShape, ...extra });
  const parsed = schema.safeParse(source);
  if (!parsed.success) throw ConfigError.fromZod('environment', parsed.error);
  const env = parsed.data as Env<S>;
  const violations = envGuardViolations(env);
  if (violations.length > 0) throw new ConfigError('environment', violations);
  return env;
}

/** Common connection settings, reused by services that need them. */
export const connectionEnv = {
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  VALKEY_URL: z.url({ protocol: /^rediss?$/ }),
} as const;
