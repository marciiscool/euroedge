import { describe, expect, it } from 'vitest';
import type { Currency, FvParams, InstrumentRef, Tick } from '@euroedge/shared';
import { FvModel, type FvModelConfig } from './model.ts';

const params: FvParams = {
  signalSigmaBp: { tradegate: { A: 8, B: 12, C: 25, D: 40 }, adr: { A: 15, B: 20, C: 35, D: 50 } },
  stalenessBp2PerSecond: 0.5,
  phi: 1.2,
  sigmaFloorBp: { A: 5, B: 10, C: 20, D: 30 },
  widenBp2PerHour: { A: 25, B: 100, C: 400, D: 900 },
  tradegateMaxSpreadBp: 30,
  maxSignalAgeSeconds: 60,
  bandSigmas: 2.5,
  confidenceBp: { high: 25, medium: 75 },
  basisHalfLifeDays: 1,
  dkkPeg: { central: 7.46038, alertBp: 50 },
};
const T0 = 1_793_000_000_000;
const H = 3_600_000;
const P: InstrumentRef = { venue: 'XLON', symbol: 'SHEL' };
const TG: InstrumentRef = { venue: 'TGAT', symbol: 'X' };
const ADR: InstrumentRef = { venue: 'XNYS', symbol: 'X' };
const USD: InstrumentRef = { venue: 'FX', symbol: 'EURUSD' };
const tick = (
  instrument: InstrumentRef,
  ts: number,
  kind: Tick['kind'],
  px: Partial<Tick>,
  currency: Currency = 'EUR',
): Tick => ({
  source: 'sim',
  instrument,
  ts,
  currency,
  kind,
  ...px,
});
const make = (over: Partial<FvModelConfig> = {}) =>
  new FvModel({
    primary: P,
    tradegate: TG,
    adr: { ref: ADR, verified: true },
    fx: USD,
    params,
    ...over,
  });

describe('FvModel M3: currencies', () => {
  it('converts a GBX close to EUR at t_C via EURGBP (GBX/100)', () => {
    const conv: InstrumentRef = { venue: 'FX', symbol: 'EURGBP' };
    const m = make({ primaryCcy: 'GBX', conversionFx: conv });
    m.onTick(tick(P, T0, 'close', { last: 2580 }, 'GBX'));
    expect(m.evaluate(T0 + 1000, { window: 'C', adrLive: false })).toBeUndefined(); // no FX yet
    m.onTick(tick(conv, T0, 'close', { last: 0.86 }, 'GBP'));
    m.onTick(tick(conv, T0 + 5000, 'quote', { bid: 0.9, ask: 0.9 }, 'GBP')); // later moves don't re-anchor
    const s = m.evaluate(T0 + 6000, { window: 'C', adrLive: false });
    expect(s?.anchor.price).toBeCloseTo(2580 / 100 / 0.86, 10);
    expect(s?.fxAlert).toBe(false);
  });

  it('converts DKK with the EURDKK feed, falls back to the peg and raises the alert', () => {
    const conv: InstrumentRef = { venue: 'FX', symbol: 'EURDKK' };
    const m = make({
      primary: { venue: 'XCSE', symbol: 'NOVO B' },
      primaryCcy: 'DKK',
      conversionFx: conv,
    });
    m.onTick(tick({ venue: 'XCSE', symbol: 'NOVO B' }, T0, 'close', { last: 335.7 }, 'DKK'));
    const peg = m.evaluate(T0 + 1000, { window: 'C', adrLive: false });
    expect(peg?.anchor.price).toBeCloseTo(335.7 / 7.46038, 10);
    expect(peg?.fxAlert).toBe(true); // no feed
    m.onTick(tick(conv, T0 + 2000, 'quote', { bid: 7.46, ask: 7.46 }, 'DKK'));
    expect(m.evaluate(T0 + 3000, { window: 'C', adrLive: false })?.fxAlert).toBe(false);
    m.onTick(tick(conv, T0 + 4000, 'quote', { bid: 7.6, ask: 7.6 }, 'DKK')); // +1.9 %: de-peg alert
    expect(m.evaluate(T0 + 5000, { window: 'C', adrLive: false })?.fxAlert).toBe(true);
  });
});

describe('FvModel M3: dividends per line', () => {
  // Local ex at T0+10h, ADR ex at T0+20h; gross 2 EUR on a 100 EUR stock, EURUSD flat 1.
  const dividends = [{ gross: 2, localExTs: T0 + 10 * H, adrExTs: T0 + 20 * H }];
  function anchored() {
    const m = make({ primary: { venue: 'XAMS', symbol: 'X' }, dividends });
    m.onTick(tick({ venue: 'XAMS', symbol: 'X' }, T0, 'close', { last: 100 }));
    m.onTick(tick(ADR, T0, 'close', { last: 100 }, 'USD'));
    m.onTick(tick(USD, T0, 'close', { last: 1 }, 'USD'));
    return m;
  }
  const at = (m: FvModel, ts: number, adrPx: number) => {
    m.onTick(tick(ADR, ts, 'quote', { bid: adrPx, ask: adrPx }, 'USD'));
    m.onTick(tick(USD, ts, 'quote', { bid: 1, ask: 1 }, 'USD'));
    return m.evaluate(ts + 1, { window: 'C', adrLive: true });
  };

  it('moves the anchor on the local ex-date and keeps the ADR on the same footing', () => {
    const m = anchored();
    expect(at(m, T0 + 5 * H, 100)?.fv).toBeCloseTo(100, 6); // before both ex-dates
    // Local ex passed, ADR still cum (100): the ADR implies a 98 local price.
    const mid = at(m, T0 + 15 * H, 100);
    expect(mid?.anchor.price).toBeCloseTo(98, 10);
    expect(mid?.fv).toBeCloseTo(98, 6);
    // ADR ex too (now 98): still 98, no double count.
    expect(at(m, T0 + 21 * H, 98)?.fv).toBeCloseTo(98, 6);
  });
});

describe('FvModel M3: ADR basis EWMA', () => {
  it('learns a persistent ADR-vs-open residual and removes it from the ADR signal', () => {
    const m = make({ primary: { venue: 'XAMS', symbol: 'X' } });
    const X: InstrumentRef = { venue: 'XAMS', symbol: 'X' };
    let ts = T0;
    for (let day = 0; day < 8; day++) {
      m.onTick(tick(X, ts, 'close', { last: 100 }));
      m.onTick(tick(ADR, ts, 'close', { last: 100 }, 'USD'));
      m.onTick(tick(USD, ts, 'close', { last: 1 }, 'USD'));
      // Overnight the ADR says +1 %, but the local line always opens flat: residual ≈ +1 %.
      m.onTick(tick(ADR, ts + 10 * H, 'quote', { bid: 101, ask: 101 }, 'USD'));
      m.onTick(tick(X, ts + 16 * H, 'auction', { last: 100 }));
      ts += 24 * H;
    }
    m.onTick(tick(X, ts, 'close', { last: 100 }));
    m.onTick(tick(ADR, ts, 'close', { last: 100 }, 'USD'));
    m.onTick(tick(USD, ts, 'close', { last: 1 }, 'USD'));
    m.onTick(tick(ADR, ts + 1000, 'quote', { bid: 101, ask: 101 }, 'USD'));
    const s = m.evaluate(ts + 2000, { window: 'C', adrLive: true });
    expect(s?.basis).toBeGreaterThan(0.009);
    expect(Math.abs(Math.log((s?.fv ?? 0) / 100))).toBeLessThan(0.001);
  });

  it('ignores unverified ADRs for the basis', () => {
    const m = make({ primary: { venue: 'XAMS', symbol: 'X' }, adr: { ref: ADR, verified: false } });
    const X: InstrumentRef = { venue: 'XAMS', symbol: 'X' };
    m.onTick(tick(X, T0, 'close', { last: 100 }));
    m.onTick(tick(ADR, T0, 'close', { last: 100 }, 'USD'));
    m.onTick(tick(USD, T0, 'close', { last: 1 }, 'USD'));
    m.onTick(tick(ADR, T0 + H, 'quote', { bid: 110, ask: 110 }, 'USD'));
    m.onTick(tick(X, T0 + 2 * H, 'auction', { last: 100 }));
    expect(m.evaluate(T0 + 2 * H, { window: 'A', adrLive: true })?.basis).toBe(0);
  });
});
