import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.ts';

const base = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  VALKEY_URL: 'redis://localhost:6379',
};

describe('fv-service config', () => {
  it('defaults to port 4020 and the sim tier', () => {
    expect(loadConfig(base)).toMatchObject({ FV_SERVICE_PORT: 4020, DATA_TIER: 'sim' });
  });

  it('rejects an invalid port', () => {
    expect(() => loadConfig({ ...base, FV_SERVICE_PORT: '70000' })).toThrow(/FV_SERVICE_PORT/);
  });
});
