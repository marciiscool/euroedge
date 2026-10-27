import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import { loadMarkets, loadSimConfig } from '@euroedge/shared/config';
import type { MarketConfig, Tick } from '@euroedge/shared';
import { SimWorld, type ScheduledFault } from './world.ts';

const cet = (iso: string) => DateTime.fromISO(iso, { zone: 'Europe/Berlin' }).toMillis();
const all = await loadMarkets();
const pick = (...ids: string[]) => all.filter((m) => ids.includes(m.id));
const world = (markets: MarketConfig[], start: string, faults: ScheduledFault[] = []) =>
  new SimWorld({ seed: 11, startTs: cet(start), markets, faults });
const of = (ticks: Tick[], venue: string, symbol?: string) =>
  ticks.filter(
    (t) => t.instrument.venue === venue && (symbol === undefined || t.instrument.symbol === symbol),
  );

describe('SimWorld v1', () => {
  it('quotes NOVO in DKK and SHEL in GBX on their primaries, EUR on Tradegate', () => {
    const w = world(pick('NOVO-PERP', 'SHEL-PERP'), '2026-10-27T10:00');
    const ticks = w.advanceTo(cet('2026-10-27T11:00'));
    const novo = of(ticks, 'XCSE').find((t) => t.kind === 'trade');
    const shel = of(ticks, 'XLON').find((t) => t.kind === 'trade');
    expect(novo?.currency).toBe('DKK');
    expect((novo?.last ?? 0) / w.truePrice('NOVO-PERP')).toBeCloseTo(w.fxRate('EURDKK'), 1);
    expect(shel?.currency).toBe('GBX');
    expect((shel?.last ?? 0) / w.truePrice('SHEL-PERP')).toBeGreaterThan(70);
    expect(of(ticks, 'TGAT', 'NOVC').every((t) => t.currency === 'EUR')).toBe(true);
  });

  it('keeps EURDKK inside the ERM II band and emits all three FX pairs', async () => {
    const w = new SimWorld({
      seed: 3,
      startTs: cet('2026-10-26T00:00'),
      markets: pick('ASML-PERP'),
      config: await loadSimConfig(),
    });
    const ticks = w.advanceTo(cet('2026-10-31T00:00'));
    const dkk = of(ticks, 'FX', 'EURDKK').flatMap((t) => (t.bid === undefined ? [] : [t.bid]));
    expect(dkk.length).toBeGreaterThan(1000);
    expect(dkk.reduce((m, x) => Math.max(m, Math.abs(x / 7.46038 - 1)), 0)).toBeLessThan(0.005);
    expect(of(ticks, 'FX', 'EURGBP').at(-1)?.currency).toBe('GBP');
  });

  it('moves stocks together through market and sector factors', () => {
    const w = world(pick('ASML-PERP', 'SAP-PERP', 'EUSEMI-PERP'), '2026-10-26T00:00');
    const ids = ['ASML-PERP', 'SAP-PERP', 'IFX'];
    const series: number[][] = ids.map(() => []);
    for (let t = cet('2026-10-26T00:00'); t < cet('2026-10-29T00:00'); t += 60_000) {
      w.advanceTo(t);
      ids.forEach((id, i) => series[i]?.push(Math.log(w.truePrice(id))));
    }
    const ret = (xs: number[]) => xs.slice(1).map((x, i) => x - (xs[i] ?? 0));
    const corr = (a: number[], b: number[]) => {
      const ma = a.reduce((s, x) => s + x, 0) / a.length;
      const mb = b.reduce((s, x) => s + x, 0) / b.length;
      let ab = 0,
        aa = 0,
        bb = 0;
      a.forEach((x, i) => {
        const y = (b[i] ?? 0) - mb;
        ab += (x - ma) * y;
        aa += (x - ma) ** 2;
        bb += y ** 2;
      });
      return ab / Math.sqrt(aa * bb);
    };
    const [asml, sap, ifx] = series.map(ret) as [number[], number[], number[]];
    // Same sector (semiconductors) correlates more than across sectors; both are positive.
    expect(corr(asml, ifx)).toBeGreaterThan(corr(asml, sap));
    expect(corr(asml, sap)).toBeGreaterThan(0.1);
  }, 120_000);

  it('drops the local line and the ADR on their own ex-dates', () => {
    // ASML (sim): local ex 23 Mar 2027 (Amsterdam), ADR ex 24 Mar 2027 (New York).
    const w = world(pick('ASML-PERP'), '2027-03-22T12:00');
    const adrOverLocal: number[] = [];
    for (const t of ['2027-03-22T23:00', '2027-03-23T12:00', '2027-03-24T12:00']) {
      w.advanceTo(cet(t));
      adrOverLocal.push(
        w['adrMid'](w['und']('ASML-PERP')) / w.fxRate('EURUSD') - w.truePrice('ASML-PERP'),
      );
    }
    // Before: no gap. Local ex passed: ADR still carries ≈ 1.85. Both passed: gap closed again.
    expect(Math.abs(adrOverLocal[0] ?? 1) / 700).toBeLessThan(0.01);
    expect((adrOverLocal[1] ?? 0) - (adrOverLocal[0] ?? 0)).toBeGreaterThan(1.5);
    expect(Math.abs((adrOverLocal[2] ?? 0) - (adrOverLocal[0] ?? 0))).toBeLessThan(0.5);
  });

  it('models auctions: indicative ticks, an opening print and a random-end close on Xetra', () => {
    const w = world(pick('SAP-PERP'), '2026-10-27T08:45');
    const ticks = of(w.advanceTo(cet('2026-10-27T17:40')), 'XETR');
    expect(ticks.some((t) => t.kind === 'indicative' && t.ts < cet('2026-10-27T09:00'))).toBe(true);
    expect(ticks.find((t) => t.kind === 'auction')?.ts).toBe(cet('2026-10-27T09:00'));
    const close = ticks.filter((t) => t.kind === 'close').at(-1);
    expect(close?.ts).toBeGreaterThanOrEqual(cet('2026-10-27T17:35'));
    expect(close?.ts).toBeLessThanOrEqual(cet('2026-10-27T17:35:30'));
  });

  it('quotes US ADRs pre-market, after hours and on the overnight venue', () => {
    const ny = (iso: string) => DateTime.fromISO(iso, { zone: 'America/New_York' }).toMillis();
    const w = new SimWorld({
      seed: 2,
      startTs: ny('2026-10-27T05:00'),
      markets: pick('ASML-PERP'),
    });
    const ticks = w.advanceTo(ny('2026-10-28T02:00'));
    const at = (venue: string, from: string, to: string) =>
      of(ticks, venue).filter((t) => t.kind === 'quote' && t.ts >= ny(from) && t.ts < ny(to))
        .length;
    expect(at('XNAS', '2026-10-27T05:00', '2026-10-27T09:30')).toBeGreaterThan(100);
    expect(at('XNAS', '2026-10-27T16:00', '2026-10-27T20:00')).toBeGreaterThan(100);
    expect(at('USON', '2026-10-27T20:00', '2026-10-28T02:00')).toBeGreaterThan(100);
    expect(at('XNAS', '2026-10-27T20:00', '2026-10-28T02:00')).toBe(0);
  });

  it('injects scheduled faults: a bad print, a stale Tradegate feed and a halt', () => {
    const faults: ScheduledFault[] = [
      { at: cet('2026-10-27T10:00'), kind: 'bad-print', underlying: 'SAP-PERP', sizeBp: 800 },
      { at: cet('2026-10-27T11:00'), kind: 'stale', underlying: 'SAP-PERP', durationSec: 900 },
      { at: cet('2026-10-27T13:00'), kind: 'halt', underlying: 'SAP-PERP', durationSec: 600 },
    ];
    const w = world(pick('SAP-PERP'), '2026-10-27T09:30', faults);
    const ticks = w.advanceTo(cet('2026-10-27T14:00'));
    const trades = of(ticks, 'XETR').filter(
      (t) => t.kind === 'trade' && t.ts >= cet('2026-10-27T10:00'),
    );
    const outlier = trades[0];
    expect(Math.abs(Math.log((outlier?.last ?? 0) / (trades[5]?.last ?? 1)))).toBeGreaterThan(0.06);
    const inWin = (xs: Tick[], from: string, to: string) =>
      xs.filter((t) => t.ts >= cet(from) && t.ts < cet(to)).length;
    expect(inWin(of(ticks, 'TGAT'), '2026-10-27T11:00:01', '2026-10-27T11:15')).toBe(0);
    expect(inWin(of(ticks, 'TGAT'), '2026-10-27T11:15', '2026-10-27T11:30')).toBeGreaterThan(100);
    expect(inWin(of(ticks, 'XETR'), '2026-10-27T13:00:01', '2026-10-27T13:10')).toBe(0);
    expect(w.faultLog.map((f) => f.kind)).toEqual(['bad-print', 'stale', 'halt']);
  });

  it('draws random faults at the configured rates, reproducibly', () => {
    const config = {
      factors: { marketVol: 0.14, sectorVol: 0.1 },
      fx: {
        EURUSD: { start: 1.08, annualVol: 0.07, meanReversionPerDay: 0.02 },
        EURGBP: { start: 0.86, annualVol: 0.05, meanReversionPerDay: 0.02 },
        EURDKK: { start: 7.46038, annualVol: 0.003, meanReversionPerDay: 0.5 },
      },
      faults: { badPrintsPerDay: 20, staleFeedsPerDay: 20, haltsPerDay: 20 },
    };
    const run = () => {
      const w = new SimWorld({
        seed: 4,
        startTs: cet('2026-10-27T00:00'),
        markets: pick('ASML-PERP'),
        config,
      });
      w.advanceTo(cet('2026-10-28T00:00'));
      return w.faultLog;
    };
    const log = run();
    expect(log.length).toBeGreaterThan(30);
    expect(new Set(log.map((f) => f.kind)).size).toBe(3);
    expect(run()).toEqual(log);
  });
});
