import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.ts';

describe('indexer config', () => {
  it('defaults to port 4050 and the sim tier', () => {
    expect(loadConfig({})).toMatchObject({ INDEXER_PORT: 4050, DATA_TIER: 'sim' });
  });

  it('reads the port from the environment', () => {
    expect(loadConfig({ INDEXER_PORT: '5999' }).INDEXER_PORT).toBe(5999);
  });

  it('rejects an invalid port', () => {
    expect(() => loadConfig({ INDEXER_PORT: '70000' })).toThrow(/INDEXER_PORT/);
  });
});
