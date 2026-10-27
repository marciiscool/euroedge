import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadFvParams, loadMarkets, loadSimConfig, loadWindows } from './load.ts';
import { allUnderlyings, basketConstituents } from '../underlyings.ts';

describe('repo config files', () => {
  it('markets.yaml is valid and lists ASML-PERP with integer tick value', async () => {
    const markets = await loadMarkets();
    expect(markets.map((m) => m.id)).toContain('ASML-PERP');
  });

  it('windows.yaml mirrors the ESMA caps and ADR-0016 parameters', async () => {
    const w = await loadWindows();
    expect(
      [w.windows.A, w.windows.B, w.windows.C, w.windows.D].map((x) => x.stockMaxLeverage),
    ).toEqual([5, 4, 3, 2]);
    expect(w.maintenanceMarginBps).toEqual({ stock: 1000, basket: 500 });
    expect(w.liquidationPenaltyBps).toEqual({ stock: 100, basket: 50 });
    expect(w.windows.D.fundingCapPpmPerHour).toBeNull();
    // MMR is 50 % of initial margin at max leverage (ESMA close-out).
    expect(w.maintenanceMarginBps.stock * 2).toBe(10_000 / w.windows.A.stockMaxLeverage);
  });

  it('fv.yaml is valid', async () => {
    const p = await loadFvParams();
    expect(p.bandSigmas).toBe(2.5);
    expect(p.phi).toBeGreaterThanOrEqual(1);
  });
});

describe('loadMarkets validation', () => {
  it('rejects a market whose tick value is not a whole number of µUSDC', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mk-'));
    await writeFile(
      join(dir, 'markets.yaml'),
      `markets:
  - { id: X-PERP, displayName: X, underlyingIsin: NL0010273215, kind: stock, primaryMic: XAMS, primarySymbol: X,
      quoteCcy: EUR, primaryCcy: EUR, tickSize: '0.0001', lotSize: '0.001', minNotional: '10',
      sector: x, enabled: true }
`,
    );
    await expect(loadMarkets(dir)).rejects.toThrow(/X-PERP: .*whole number/);
  });
});

describe('markets.yaml (the ten brief markets plus six more stocks)', () => {
  it('loads, resolves basket constituents and exposes every underlying once', async () => {
    const markets = await loadMarkets();
    expect(markets.map((m) => m.id)).toEqual([
      'ASML-PERP',
      'SAP-PERP',
      'EUBLUE20-PERP',
      'NOVO-PERP',
      'SIE-PERP',
      'SHEL-PERP',
      'TTE-PERP',
      'EUSEMI-PERP',
      'RHM-PERP',
      'MC-PERP',
      'ALV-PERP',
      'AIR-PERP',
      'DTE-PERP',
      'IFX-PERP',
      'SU-PERP',
      'OR-PERP',
    ]);
    const blue = markets.find((m) => m.id === 'EUBLUE20-PERP');
    if (blue === undefined) throw new Error('missing basket');
    const cs = basketConstituents(blue, markets);
    expect(cs).toHaveLength(20);
    expect(cs.find((c) => c.id === 'ASML')?.underlying.primaryMic).toBe('XAMS');
    const all = allUnderlyings(markets);
    expect(new Set(all.map((u) => u.underlyingIsin)).size).toBe(all.length);
    expect(all.every((u) => u.sim !== undefined)).toBe(true);
    // Non-EUR primaries carry a EUR price source (ADR-0017).
    for (const id of ['NOVO-PERP', 'SHEL-PERP'])
      expect(markets.find((m) => m.id === id)?.priceSourceOverride).toEqual({
        venue: 'TGAT',
        ccy: 'EUR',
      });
  });

  it('rejects basket weights that do not sum to 100 %', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mk-'));
    await writeFile(
      join(dir, 'markets.yaml'),
      `markets:
  - { id: A-PERP, displayName: A, underlyingIsin: NL0010273215, kind: stock, primaryMic: XAMS, primarySymbol: A,
      quoteCcy: EUR, primaryCcy: EUR, tickSize: '0.01', lotSize: '0.01', minNotional: '10', sector: x, enabled: true }
  - id: B-PERP
    displayName: B
    kind: basket
    primaryMic: XETR
    quoteCcy: EUR
    primaryCcy: EUR
    tickSize: '0.01'
    lotSize: '0.001'
    minNotional: '10'
    sector: basket
    enabled: false
    basket:
      status: draft
      methodology: x
      startLevel: '1000'
      capBps: 6000
      rebalance: quarterly
      constituents:
        - { id: A, market: A-PERP, weightBps: 5000 }
        - { id: C, market: A-PERP, weightBps: 4000 }
`,
    );
    await expect(loadMarkets(dir)).rejects.toThrow(/sum to 9000/);
  });
});

describe('sim.yaml', () => {
  it('is valid and keeps EURDKK pegged near the ERM II central rate', async () => {
    const sim = await loadSimConfig();
    expect(sim.fx.EURDKK.start).toBeCloseTo(7.46038, 5);
    expect(sim.fx.EURDKK.meanReversionPerDay).toBeGreaterThan(0.1);
  });
});
