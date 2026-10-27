import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.ts';

describe('fv-service config', () => {
  it('defaults to port 4020 and the sim tier', () => {
    expect(loadConfig({})).toMatchObject({ FV_SERVICE_PORT: 4020, DATA_TIER: 'sim' });
  });

  it('reads the port from the environment', () => {
    expect(loadConfig({ FV_SERVICE_PORT: '5999' }).FV_SERVICE_PORT).toBe(5999);
  });

  it('rejects an invalid port', () => {
    expect(() => loadConfig({ FV_SERVICE_PORT: '70000' })).toThrow(/FV_SERVICE_PORT/);
  });
});
