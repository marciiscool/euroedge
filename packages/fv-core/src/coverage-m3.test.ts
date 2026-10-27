import { describe, expect, it } from 'vitest';
import type { FvParams, InstrumentRef, MarketConfig, Tick } from '@euroedge/shared';
import { loadFvParams, loadMarkets } from '@euroedge/shared/config';
import { BasketFvPipeline } from './basket.ts';
import { EwmaCovariance } from './covariance.ts';
import { FvModel } from './model.ts';
import { MarketFvPipeline } from './pipeline.ts';

const T0 = 1_793_000_000_000;
const X: InstrumentRef = { venue: 'XLON', symbol: 'X' };
const close = (instrument: InstrumentRef, last: number): Tick => ({
  source: 'sim',
  instrument,
  ts: T0,
  currency: 'GBP',
  kind: 'close',
  last,
});

describe('edge cases (M3)', () => {
  it('covariance: zero variance, short vectors and short weights stay finite', () => {
    const c = new EwmaCovariance(2, 0.9, 1);
    for (let k = 0; k < 3; k++) c.update([0, 0]);
    expect(c.correlation(0, 1)).toBe(1);
    c.update([0.01]);
    expect(c.portfolioSigma([1], [0.02])).toBeCloseTo(0.02, 12);
  });

  it('model: GBP lines convert via EURGBP; USD primaries cannot anchor', async () => {
    const params: FvParams = await loadFvParams();
    const conv: InstrumentRef = { venue: 'FX', symbol: 'EURGBP' };
    const gbp = new FvModel({
      primary: X,
      primaryCcy: 'GBP',
      conversionFx: conv,
      fx: { venue: 'FX', symbol: 'EURUSD' },
      params,
    });
    gbp.onTick(close(X, 86));
    gbp.onTick({ ...close(conv, 0.86), currency: 'GBP' });
    expect(gbp.evaluate(T0 + 1, { window: 'C', adrLive: false })?.anchor.price).toBeCloseTo(
      100,
      10,
    );
    const usd = new FvModel({
      primary: X,
      primaryCcy: 'USD',
      fx: { venue: 'FX', symbol: 'EURUSD' },
      params,
    });
    usd.onTick(close(X, 100));
    expect(usd.evaluate(T0 + 1, { window: 'C', adrLive: false })).toBeUndefined();
  });

  it('pipelines: SHEL converts through EURGBP; a basket config is refused by the stock pipeline', async () => {
    const markets = await loadMarkets();
    const params = await loadFvParams();
    const shel = markets.find((m) => m.id === 'SHEL-PERP') as MarketConfig;
    expect(new MarketFvPipeline(shel, params, 50).instruments()).toContainEqual({
      venue: 'FX',
      symbol: 'EURGBP',
    });
    const blue = markets.find((m) => m.id === 'EUBLUE20-PERP') as MarketConfig;
    expect(() => new MarketFvPipeline(blue, params, 50)).toThrow(/BasketFvPipeline/);
    expect(() => new BasketFvPipeline(shel, markets, params, 50)).toThrow(/not a basket/);
  });

  it('basket: base prices default to the first anchor; non-EUR members read the EUR line', async () => {
    const markets = await loadMarkets();
    const params = await loadFvParams();
    const novo = markets.find((m) => m.id === 'NOVO-PERP') as MarketConfig;
    const sap = markets.find((m) => m.id === 'SAP-PERP') as MarketConfig;
    const { sim: _sim, ...sapNoSim } = sap;
    const basket: MarketConfig = {
      ...sap,
      id: 'TEST-PERP',
      kind: 'basket',
      basket: {
        status: 'draft',
        methodology: 'test',
        startLevel: '100',
        capBps: 6000,
        rebalance: 'quarterly',
        constituents: [
          { id: 'NOVO', market: 'NOVO-PERP', weightBps: 5000 },
          {
            ...sapNoSim,
            id: 'SAPX',
            name: 'SAP copy',
            primarySymbol: 'SAP',
            underlyingIsin: 'DE0007164600',
            weightBps: 5000,
          },
        ],
      },
    };
    const p = new BasketFvPipeline(basket, [novo, sap], params, 50);
    expect(p.instruments()).toContainEqual({ venue: 'FX', symbol: 'EURDKK' });
    p.onTick({ ...close({ venue: 'XETR', symbol: 'SAP' }, 230), currency: 'EUR' });
    expect(p.evaluate(T0 + 1)?.snapshot.fv).toBeCloseTo(100, 6); // SAP alone: 50 % coverage
    expect(p.evaluate(T0 + 2)?.snapshot.dropped).toEqual(['NOVO']);
  });
});
