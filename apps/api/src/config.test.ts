import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.ts';

const base = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  VALKEY_URL: 'redis://localhost:6379',
};

describe('api config', () => {
  it('defaults to port 4000, the sim tier and a dev-only secret locally', () => {
    const c = loadConfig(base);
    expect(c).toMatchObject({
      API_PORT: 4000,
      DATA_TIER: 'sim',
      PUBLIC_ORIGIN: 'http://localhost:8080',
    });
    expect(c.SESSION_SECRET.length).toBeGreaterThanOrEqual(32);
  });

  it('requires a real secret in deployed builds and rejects short ones', () => {
    expect(() => loadConfig({ ...base, DEPLOY_ENV: 'production' })).toThrow(
      /SESSION_SECRET is required/,
    );
    expect(() => loadConfig({ ...base, SESSION_SECRET: 'short' })).toThrow(/at least 32/);
  });

  it('rejects an invalid port', () => {
    expect(() => loadConfig({ ...base, API_PORT: '70000' })).toThrow(/API_PORT/);
  });
});
