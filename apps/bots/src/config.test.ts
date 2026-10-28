import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.ts';

describe('bots config', () => {
  it('defaults to port 4060 and the sim tier', () => {
    expect(loadConfig({})).toMatchObject({ BOTS_PORT: 4060, DATA_TIER: 'sim' });
  });

  it('reads the port from the environment', () => {
    expect(loadConfig({ BOTS_PORT: '5999' }).BOTS_PORT).toBe(5999);
  });

  it('rejects an invalid port', () => {
    expect(() => loadConfig({ BOTS_PORT: '70000' })).toThrow(/BOTS_PORT/);
  });

  it('refuses to run bots outside the sim tier', () => {
    expect(() => loadConfig({ BOTS_ENABLED: 'true', DATA_TIER: 'replay' })).toThrow(
      /DATA_TIER=sim/,
    );
    expect(loadConfig({ BOTS_ENABLED: 'true' }).BOTS_COUNT).toBe(200);
  });
});
