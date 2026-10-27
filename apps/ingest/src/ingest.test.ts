import { describe, expect, it } from 'vitest';
import type { Tick } from '@euroedge/shared';
import { loadConfig } from './config.ts';
import { replaySource } from './replay-start.ts';
import { TickWriter } from './writer.ts';

const tick: Tick = {
  source: 'sim',
  instrument: { venue: 'XAMS', symbol: 'ASML' },
  ts: 1_000,
  currency: 'EUR',
  kind: 'trade',
  last: 700,
};

describe('ingest v1', () => {
  it('drops exact duplicates per stream but keeps new prices and other kinds', async () => {
    const w = new TickWriter('postgres://unused@localhost:1/none');
    expect(w.push(tick)).toBe(true);
    expect(w.push({ ...tick })).toBe(false);
    expect(w.push({ ...tick, last: 701 })).toBe(true);
    expect(w.push({ ...tick, kind: 'close' })).toBe(true);
    expect(w.duplicates).toBe(1);
    await w.close();
  });

  it('defaults replay to the committed sample at 60x', () => {
    const c = loadConfig({
      DATA_TIER: 'replay',
      DATABASE_URL: 'postgres://x',
      VALKEY_URL: 'redis://x',
    });
    expect(c.REPLAY_FILE).toMatch(/data\/sample\/.*\.csv\.gz$/);
    expect(c.REPLAY_SPEED).toBe(60);
  });

  it('replays the sample file through the provider', async () => {
    const r = await replaySource('data/sample/sim-2027-03-15_2027-03-31.csv.gz', 1000);
    expect(r.count).toBeGreaterThan(100_000);
    const first = r.advance();
    expect(first.length).toBeGreaterThan(0);
    expect(first.every((t) => t.source === 'replay')).toBe(true);
  });
});
