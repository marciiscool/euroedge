import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.ts';

describe('engine config', () => {
  it('defaults to port 4010 and the sim tier', () => {
    expect(loadConfig({})).toMatchObject({ ENGINE_PORT: 4010, DATA_TIER: 'sim' });
  });

  it('reads the port from the environment', () => {
    expect(loadConfig({ ENGINE_PORT: '5999' }).ENGINE_PORT).toBe(5999);
  });

  it('rejects an invalid port', () => {
    expect(() => loadConfig({ ENGINE_PORT: '70000' })).toThrow(/ENGINE_PORT/);
  });
});
