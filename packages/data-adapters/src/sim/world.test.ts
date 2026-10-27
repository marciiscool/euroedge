import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import type { MarketConfig, Tick } from '@euroedge/shared';
import { SimWorld } from './world.ts';
import { Rng } from './rng.ts';
import { SimulatedProvider } from './provider.ts';

const ASML: MarketConfig = {
  id: 'ASML-PERP',
  displayName: 'ASML Holding',
  underlyingIsin: 'NL0010273215',
  kind: 'stock',
  primaryMic: 'XAMS',
  primarySymbol: 'ASML',
  extendedMic: 'TGAT',
  quoteCcy: 'EUR',
  primaryCcy: 'EUR',
  tickSize: '0.01',
  lotSize: '0.01',
  minNotional: '10',
  adr: { venue: 'XNAS', symbol: 'ASML', ratio: '1', verified: true },
  tradegateSymbol: 'ASML',
  sector: 'semiconductors',
  enabled: true,
  sim: { startPrice: '700', annualVol: '0.32', jumpsPerYear: '6', jumpVol: '0.03', dividends: [] },
};
const cet = (iso: string) => DateTime.fromISO(iso, { zone: 'Europe/Berlin' }).toMillis();
const make = (seed = 42, start = cet('2026-10-27T07:00')) =>
  new SimWorld({ seed, startTs: start, markets: [ASML] });
const byVenue = (ticks: Tick[], venue: string) => ticks.filter((t) => t.instrument.venue === venue);

describe('Rng', () => {
  it('is deterministic per seed and roughly standard normal', () => {
    const a = new Rng(7);
    const b = new Rng(7);
    const xs = Array.from({ length: 20_000 }, () => a.normal());
    expect(Array.from({ length: 5 }, () => b.normal())).toEqual(xs.slice(0, 5));
    const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
    const variance = xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length;
    expect(Math.abs(mean)).toBeLessThan(0.03);
    expect(Math.abs(variance - 1)).toBeLessThan(0.05);
  });
});

describe('SimWorld', () => {
  it('emits previous closes first, so consumers have anchors immediately', () => {
    const first = make().advanceTo(cet('2026-10-27T07:00'));
    expect(first.map((t) => `${t.instrument.venue}:${t.kind}`)).toEqual([
      'XAMS:close',
      'XNAS:close',
      'FX:close',
      'FX:close',
      'FX:close',
    ]);
  });

  it('is reproducible and independent of how advanceTo is chunked', () => {
    const end = cet('2026-10-27T10:00');
    const whole = make().advanceTo(end);
    const w = make();
    const chunked: Tick[] = [];
    for (let t = cet('2026-10-27T07:00'); t <= end; t += 37_000) chunked.push(...w.advanceTo(t));
    chunked.push(...w.advanceTo(end));
    expect(chunked).toEqual(whole);
    expect(make(43).advanceTo(end)).not.toEqual(whole);
  });

  it('only emits each venue inside its session, with one official close per day', () => {
    const ticks = make().advanceTo(cet('2026-10-28T07:00'));
    const xams = byVenue(ticks, 'XAMS').filter((t) => t.kind === 'trade');
    const tg = byVenue(ticks, 'TGAT');
    const us = byVenue(ticks, 'XNAS').filter((t) => t.kind === 'quote');
    // 27–28 Oct 2026 are entirely CET (UTC+1): a fixed offset is exact here and avoids
    // building a Luxon DateTime for each of ~100k ticks.
    const hour = (t: Tick) => {
      const m = (Math.floor(t.ts / 60_000) + 60) % 1440;
      return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    };
    expect(xams.every((t) => hour(t) >= '09:00' && hour(t) < '17:30')).toBe(true);
    expect(tg.every((t) => hour(t) >= '08:00' && hour(t) < '22:00')).toBe(true);
    // DST mismatch week: US pre-market to after-hours is 04:00–20:00 New York = 09:00–01:00 CET.
    expect(us.every((t) => hour(t) >= '09:00' || hour(t) < '01:00')).toBe(true);
    const closes = byVenue(ticks, 'XAMS').filter((t) => t.kind === 'close');
    expect(closes.map(hour)).toEqual(['07:00', '17:35']);
    expect(xams.length).toBeGreaterThan(5_000);
  });

  it('keeps venues consistent with the latent price and quotes well-formed', () => {
    const w = make(9);
    const ticks = w.advanceTo(cet('2026-10-27T12:00'));
    const last = byVenue(ticks, 'TGAT').at(-1);
    expect(last?.bid).toBeLessThan(last?.ask ?? 0);
    const mid = ((last?.bid ?? 0) + (last?.ask ?? 0)) / 2;
    expect(Math.abs(Math.log(mid / w.truePrice('ASML-PERP')))).toBeLessThan(0.003);
  });

  it('produces overnight gaps: Tradegate keeps moving after the primary close', () => {
    const w = make(5, cet('2026-10-27T17:00'));
    const ticks = w.advanceTo(cet('2026-10-28T09:05'));
    const close = byVenue(ticks, 'XAMS').find(
      (t) => t.kind === 'close' && t.ts > cet('2026-10-27T17:00'),
    );
    const open = byVenue(ticks, 'XAMS').find(
      (t) => t.kind === 'trade' && t.ts >= cet('2026-10-28T09:00'),
    );
    expect(close?.last).toBeDefined();
    expect(open?.last).not.toBe(close?.last);
  });

  it('rejects a start that is not a whole second', () => {
    expect(() => new SimWorld({ seed: 1, startTs: 1_500, markets: [ASML] })).toThrow(
      /whole second/,
    );
  });
});

describe('SimulatedProvider', () => {
  it('delivers only subscribed instruments and reports health', () => {
    let now = cet('2026-10-27T10:00');
    const p = new SimulatedProvider({ seed: 1, markets: [ASML], now: () => now });
    const got: Tick[] = [];
    const unsub = p.subscribe([{ venue: 'TGAT', symbol: 'ASML' }], (t) => got.push(t));
    now += 60_000;
    p.poll();
    expect(got.length).toBeGreaterThan(10);
    expect(got.every((t) => t.instrument.venue === 'TGAT')).toBe(true);
    expect(p.health().connected).toBe(true);
    expect(p.health().lastTickAgeMs).toBeLessThan(2_000);
    unsub();
    expect(p.health().connected).toBe(false);
  });
});
