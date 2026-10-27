import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadFvParams, loadMarkets, loadWindows } from './load.ts';

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
  - { id: X-PERP, displayName: X, underlyingIsin: NL0010273215, kind: stock, primaryMic: XAMS,
      quoteCcy: EUR, primaryCcy: EUR, tickSize: '0.0001', lotSize: '0.001', minNotional: '10',
      sector: x, enabled: true }
`,
    );
    await expect(loadMarkets(dir)).rejects.toThrow(/X-PERP: .*whole number/);
  });
});
