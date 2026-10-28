import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import type { Tick } from '@euroedge/shared';
import { loadFvParams, loadMarkets } from '@euroedge/shared/config';
import { MarketBreakers } from './breakers.ts';
import { MarketFvPipeline } from './pipeline.ts';

const cet = (iso: string) => DateTime.fromISO(iso, { zone: 'Europe/Berlin' }).toMillis();
const params = await loadFvParams();
const sap = (await loadMarkets()).find((m) => m.id === 'SAP-PERP');
if (sap === undefined) throw new Error('no SAP');
const t = (venue: 'XETR' | 'TGAT', iso: string, kind: Tick['kind'], px: Partial<Tick>): Tick => ({
  source: 'sim',
  instrument: { venue, symbol: 'SAP' },
  ts: cet(iso),
  currency: 'EUR',
  kind,
  ...px,
});

function preOpen() {
  const p = new MarketFvPipeline(sap as NonNullable<typeof sap>, params, 50);
  p.onTick(t('XETR', '2026-10-26T17:35', 'close', { last: 230 }));
  p.onTick(t('TGAT', '2026-10-27T08:59:50', 'quote', { bid: 229.98, ask: 230.02 }));
  p.evaluate(cet('2026-10-27T08:59:59'));
  return p;
}

describe('reopen snap (M3-08/09)', () => {
  it('never snaps to indicative prints', () => {
    const p = preOpen();
    p.onTick(t('XETR', '2026-10-27T08:59:58', 'indicative', { last: 250 }));
    expect(p.evaluate(cet('2026-10-27T09:00:00'))?.snapshot.snap).toBeUndefined();
  });

  it('moves FV, index and band centre to the opening print and lifts the step cap', () => {
    const p = preOpen();
    p.onTick(t('XETR', '2026-10-27T09:00:00', 'auction', { last: 230.3 }));
    const out = p.evaluate(cet('2026-10-27T09:00:01'));
    expect(out?.snapshot.snap).toMatchObject({ price: 230.3, outsideBand: false });
    expect(out?.snapshot.fv).toBe(230.3);
    expect(out?.update.mark).toBe(23_030n);
    expect(out?.snapshot.bandLo).toBeLessThan(230.3);
    expect(out?.snapshot.bandHi).toBeGreaterThan(230.3);
    // After capSuspendSeconds the normal model and step cap resume.
    expect(p.evaluate(cet('2026-10-27T09:01:01'))?.snapshot.snap).toBeUndefined();
  });

  it('flags an open outside the prior band and turns the market reduce-only for 5 min', () => {
    const p = preOpen();
    p.onTick(t('XETR', '2026-10-27T09:00:00', 'auction', { last: 245 })); // +6.5 %
    const out = p.evaluate(cet('2026-10-27T09:00:01'));
    expect(out?.snapshot.snap?.outsideBand).toBe(true);
    // +6.5 % in one second: only possible with the 50 bp/s step cap suspended.
    expect(out?.update.mark).toBe(24_500n);
    const b = new MarketBreakers(params);
    const input = (ts: number) => ({
      ts,
      window: 'A' as const,
      sigma: 0.001,
      sources: [],
      tradegateScheduled: false,
      liveExpected: false,
      primaryHalted: false,
      mark: 100n,
      bandLo: 0n,
      bandHi: 1000n,
    });
    const snap = { ts: cet('2026-10-27T09:00:00'), outsideBand: true };
    expect(b.evaluate({ ...input(cet('2026-10-27T09:00:01')), snap }).effect).toBe('reduce-only');
    expect(b.evaluate(input(cet('2026-10-27T09:04:59'))).active).toEqual(['SNAP']);
    expect(b.evaluate(input(cet('2026-10-27T09:05:00'))).active).toEqual([]);
  });
});
