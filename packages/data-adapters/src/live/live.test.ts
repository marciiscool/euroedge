import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import type { InstrumentRef, Tick } from '@euroedge/shared';
import { FeedMonitor } from './feed-monitor.ts';
import { ProviderNotConfiguredError, SOURCE_META, sourcesForTier } from './meta.ts';
import { parsePythMessage, PythProvider, pythSymbol, type PythTransport } from './pyth.ts';
import { EurexProvider, TradegateProvider, XetraDelayedProvider } from './stubs.ts';

const cet = (iso: string) => DateTime.fromISO(iso, { zone: 'Europe/Berlin' }).toMillis();
const ASML_US: InstrumentRef = { venue: 'XNAS', symbol: 'ASML' };
const EURUSD: InstrumentRef = { venue: 'FX', symbol: 'EURUSD' };
// Recorded-shape fixture (see the ASSUMPTION note in pyth.ts).
const FIXTURE = JSON.stringify({
  type: 'streamUpdated',
  subscriptionId: 1,
  parsed: {
    timestampUs: '1793100000123456',
    priceFeeds: [
      {
        priceFeedId: 1001,
        price: '75512000000',
        bestBidPrice: '75500000000',
        bestAskPrice: '75524000000',
        exponent: -8,
      },
      { priceFeedId: 2001, price: '108123', exponent: -5 },
      { priceFeedId: 9999, price: '1', exponent: 0 },
    ],
  },
});
const feeds = { 'Equity.US.ASML/USD': 1001, 'FX.EUR/USD': 2001 };

describe('PythProvider (key-gated)', () => {
  it('maps US listings and FX to Pyth symbols, nothing for EU venues', () => {
    expect(pythSymbol(ASML_US)).toBe('Equity.US.ASML/USD');
    expect(pythSymbol(EURUSD)).toBe('FX.EUR/USD');
    expect(pythSymbol({ venue: 'XAMS', symbol: 'ASML' })).toBeUndefined();
  });

  it('refuses to start without a key and never touches the transport', () => {
    let connects = 0;
    const transport: PythTransport = {
      connect: () => {
        connects++;
        return { send: () => undefined, close: () => undefined };
      },
    };
    expect(() => new PythProvider({ apiKey: undefined, transport, feedIds: feeds })).toThrow(
      ProviderNotConfiguredError,
    );
    expect(() => new PythProvider({ apiKey: '', transport, feedIds: feeds })).toThrow(
      /PYTH_API_KEY/,
    );
    expect(connects).toBe(0);
  });

  it('parses a recorded stream message into quotes and trades', () => {
    const ticks = parsePythMessage(
      FIXTURE,
      new Map([
        [1001, ASML_US],
        [2001, EURUSD],
      ]),
    );
    expect(ticks).toHaveLength(2);
    expect(ticks[0]).toMatchObject({
      kind: 'quote',
      bid: 755,
      ask: 755.24,
      currency: 'USD',
      ts: 1793100000123,
    });
    expect(ticks[1]).toMatchObject({
      kind: 'trade',
      last: 1.08123,
      currency: 'USD',
      instrument: EURUSD,
    });
  });

  it('subscribes with feed ids and delivers ticks through a fake transport', () => {
    const sent: string[] = [];
    let deliver: (raw: string) => void = () => undefined;
    const transport: PythTransport = {
      connect: (onMessage) => {
        deliver = onMessage;
        return { send: (r) => sent.push(r), close: () => undefined };
      },
    };
    const p = new PythProvider({ apiKey: 'k', transport, feedIds: feeds, now: () => 0 });
    const got: Tick[] = [];
    const unsub = p.subscribe([ASML_US, EURUSD], (t) => got.push(t));
    expect(JSON.parse(sent[0] ?? '{}')).toMatchObject({
      type: 'subscribe',
      priceFeedIds: [1001, 2001],
    });
    deliver(FIXTURE);
    deliver('not json');
    expect(got).toHaveLength(2);
    expect(p.health()).toMatchObject({ connected: true, errorRate: 0.5 });
    unsub();
    expect(p.health().connected).toBe(false);
  });
});

describe('stub providers', () => {
  it('refuse to subscribe with a clear reason and carry licence metadata', () => {
    for (const p of [new TradegateProvider(), new XetraDelayedProvider(), new EurexProvider()]) {
      expect(() => p.subscribe([], () => undefined)).toThrow(ProviderNotConfiguredError);
      expect(p.health().connected).toBe(false);
      expect(SOURCE_META[p.id].redistributionAllowed).toBe(false);
    }
    expect(SOURCE_META.sim.redistributionAllowed).toBe(true);
    expect(sourcesForTier('sim')).toEqual(['sim']);
    expect(sourcesForTier('live-min')).toEqual(['tradegate', 'pyth']);
  });
});

describe('FeedMonitor (halt from feed silence)', () => {
  const XETR_SAP: InstrumentRef = { venue: 'XETR', symbol: 'SAP' };
  const tick = (ts: number): Tick => ({
    source: 'sim',
    instrument: XETR_SAP,
    ts,
    currency: 'EUR',
    kind: 'trade',
    last: 230,
  });

  it('reports calendar states, halts after 60 s of silence in continuous trading, and recovers', () => {
    const m = new FeedMonitor();
    expect(m.status(XETR_SAP, cet('2026-10-27T08:55'))).toBe('openingAuction');
    expect(m.status(XETR_SAP, cet('2026-10-27T09:00:30'))).toBe('continuous'); // grace after the open
    expect(m.status(XETR_SAP, cet('2026-10-27T09:01:01'))).toBe('halted');
    m.onTick(tick(cet('2026-10-27T09:01:30')));
    expect(m.status(XETR_SAP, cet('2026-10-27T09:02:00'))).toBe('continuous');
    expect(m.status(XETR_SAP, cet('2026-10-27T09:02:31'))).toBe('halted');
    expect(
      m.status(XETR_SAP, cet('2026-10-27T12:00'), {
        connected: false,
        lastTickAgeMs: undefined,
        errorRate: 0,
      }),
    ).toBe('provider-down');
    expect(m.status(XETR_SAP, cet('2026-04-03T12:00'))).toBe('closed'); // Good Friday
  });
});
