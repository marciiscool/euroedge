import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.ts';

describe('ingest config', () => {
  it('defaults to port 4030 and the sim tier', () => {
    expect(loadConfig({})).toMatchObject({ INGEST_PORT: 4030, DATA_TIER: 'sim' });
  });

  it('reads the port from the environment', () => {
    expect(loadConfig({ INGEST_PORT: '5999' }).INGEST_PORT).toBe(5999);
  });

  it('rejects an invalid port', () => {
    expect(() => loadConfig({ INGEST_PORT: '70000' })).toThrow(/INGEST_PORT/);
  });
});
