import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.ts';

describe('relayer config', () => {
  it('defaults to port 4040 and the sim tier', () => {
    expect(loadConfig({})).toMatchObject({ RELAYER_PORT: 4040, DATA_TIER: 'sim' });
  });

  it('reads the port from the environment', () => {
    expect(loadConfig({ RELAYER_PORT: '5999' }).RELAYER_PORT).toBe(5999);
  });

  it('rejects an invalid port', () => {
    expect(() => loadConfig({ RELAYER_PORT: '70000' })).toThrow(/RELAYER_PORT/);
  });
});
