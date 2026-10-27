import fc from 'fast-check';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { connectionEnv, envGuardViolations, loadEnv } from './env.ts';
import { ConfigError } from './errors.ts';

describe('loadEnv', () => {
  it('applies defaults: sim tier, dev login off, local deploy', () => {
    const env = loadEnv({}, {});
    expect(env).toMatchObject({
      DATA_TIER: 'sim',
      DEV_LOGIN: false,
      DEPLOY_ENV: 'local',
      NODE_ENV: 'development',
    });
  });

  it('parses service-specific variables', () => {
    const env = loadEnv(
      { ...connectionEnv, PORT: z.coerce.number().int().positive() },
      {
        DATABASE_URL: 'postgres://u:p@localhost:5432/db',
        VALKEY_URL: 'redis://localhost:6379',
        PORT: '4000',
      },
    );
    expect(env.PORT).toBe(4000);
    expect(env.DATABASE_URL).toBe('postgres://u:p@localhost:5432/db');
  });

  it('reports all problems at once', () => {
    try {
      loadEnv(connectionEnv, { DATA_TIER: 'live', DATABASE_URL: 'http://x' });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      const msgs = (err as ConfigError).issues.join('\n');
      expect(msgs).toMatch(/DATA_TIER/);
      expect(msgs).toMatch(/DATABASE_URL/);
      expect(msgs).toMatch(/VALKEY_URL/);
    }
  });

  it('accepts DEV_LOGIN=true with DATA_TIER=sim locally', () => {
    expect(loadEnv({}, { DEV_LOGIN: 'true' }).DEV_LOGIN).toBe(true);
  });

  it.each(['replay', 'live-min'])('refuses DEV_LOGIN=true with DATA_TIER=%s', (tier) => {
    expect(() => loadEnv({}, { DEV_LOGIN: 'true', DATA_TIER: tier })).toThrow(
      /DEV_LOGIN=true requires DATA_TIER=sim/,
    );
  });

  it.each(['staging', 'production'])('refuses DEV_LOGIN=true when DEPLOY_ENV=%s', (deploy) => {
    expect(() => loadEnv({}, { DEV_LOGIN: 'true', DEPLOY_ENV: deploy })).toThrow(
      /forbidden in deployed builds/,
    );
  });
});

describe('envGuardViolations', () => {
  it('never allows dev login outside sim+local/ci (property)', () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.constantFrom('sim', 'replay', 'live-min'),
        fc.constantFrom('local', 'ci', 'staging', 'production'),
        (DEV_LOGIN, DATA_TIER, DEPLOY_ENV) => {
          const ok = envGuardViolations({ DEV_LOGIN, DATA_TIER, DEPLOY_ENV }).length === 0;
          const allowed =
            !DEV_LOGIN || (DATA_TIER === 'sim' && (DEPLOY_ENV === 'local' || DEPLOY_ENV === 'ci'));
          expect(ok).toBe(allowed);
        },
      ),
    );
  });
});
