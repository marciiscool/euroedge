import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.ts';

describe('api config', () => {
  it('defaults to port 4000 and the sim tier', () => {
    expect(loadConfig({})).toMatchObject({ API_PORT: 4000, DATA_TIER: 'sim' });
  });

  it('reads the port from the environment', () => {
    expect(loadConfig({ API_PORT: '5999' }).API_PORT).toBe(5999);
  });

  it('rejects an invalid port', () => {
    expect(() => loadConfig({ API_PORT: '70000' })).toThrow(/API_PORT/);
  });
});
