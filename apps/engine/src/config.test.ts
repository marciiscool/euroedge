import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.ts';

const base = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  VALKEY_URL: 'redis://localhost:6379',
};

describe('engine config', () => {
  it('defaults to port 4010 and the sim tier', () => {
    expect(loadConfig(base)).toMatchObject({ ENGINE_PORT: 4010, DATA_TIER: 'sim' });
  });

  it('requires database and valkey URLs', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });

  it('rejects an invalid port', () => {
    expect(() => loadConfig({ ...base, ENGINE_PORT: '70000' })).toThrow(/ENGINE_PORT/);
  });
});
