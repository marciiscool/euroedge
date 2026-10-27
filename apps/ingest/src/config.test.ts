import { describe, expect, it } from 'vitest';
import { loadMarkets } from '@euroedge/shared/config';
import { defaultSimEpoch, loadConfig } from './config.ts';
import { fastForward } from './sim-start.ts';

const base = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  VALKEY_URL: 'redis://localhost:6379',
};

describe('ingest config', () => {
  it('defaults: port 4030, seed 42, sim tier', () => {
    expect(loadConfig(base)).toMatchObject({ INGEST_PORT: 4030, SIM_SEED: 42, DATA_TIER: 'sim' });
  });

  it('rejects an invalid port', () => {
    expect(() => loadConfig({ ...base, INGEST_PORT: '70000' })).toThrow(/INGEST_PORT/);
  });

  it('default epoch is the most recent Monday 00:00 UTC', () => {
    const tue = Date.UTC(2026, 9, 27, 15, 30); // Tuesday 27 Oct 2026
    expect(new Date(defaultSimEpoch(tue)).toISOString()).toBe('2026-10-26T00:00:00.000Z');
    const mon = Date.UTC(2026, 9, 26, 0, 0);
    expect(defaultSimEpoch(mon)).toBe(mon);
  });
});

describe('fastForward', () => {
  it('reproduces the same latest state for the same seed and epoch', async () => {
    const markets = (await loadMarkets()).filter((m) => m.enabled);
    const epoch = Date.UTC(2026, 9, 26);
    const now = Date.UTC(2026, 9, 27, 10, 0, 0);
    const a = fastForward(42, epoch, now, markets);
    const b = fastForward(42, epoch, now, markets);
    expect(a.snapshot).toEqual(b.snapshot);
    const kinds = a.snapshot.map((t) => `${t.instrument.venue}:${t.kind}`);
    expect(kinds).toContain('XAMS:close');
    expect(kinds).toContain('TGAT:quote');
    expect(a.world.now).toBe(now);
  }, 30_000);
});
