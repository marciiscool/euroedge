import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadTickFile } from '@euroedge/data-adapters';
import { loadFvParams, loadMarkets } from '@euroedge/shared/config';
import { normCdf, reportSchema, summarize } from './metrics.ts';
import { runBacktest } from './run.ts';

describe('metrics', () => {
  it('normCdf matches known values', () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 7);
    expect(normCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normCdf(-1.96)).toBeCloseTo(0.025, 3);
  });

  it('summarizes errors, coverage and the PIT histogram', () => {
    const m = summarize([
      { errBp: 10, naiveBp: 40, inBand: true, pit: 0.55 },
      { errBp: -20, naiveBp: -40, inBand: false, pit: 0.05 },
    ]);
    expect(m).toMatchObject({
      n: 2,
      maeBp: 15,
      naiveMaeBp: 40,
      improvement: 0.625,
      bandCoverage: 0.5,
    });
    expect(m.pitHistogram[0]).toBe(1);
    expect(m.pitHistogram[5]).toBe(1);
    expect(summarize([]).n).toBe(0);
  });
});

describe('runBacktest on the committed sample', () => {
  it('scores FV against each official open and beats the naive close before the open', async () => {
    const file = fileURLToPath(
      new URL('../../../data/sample/sim-2027-03-15_2027-03-31.csv.gz', import.meta.url),
    );
    const until = Date.parse('2027-03-20T00:00:00Z');
    const ticks = (await loadTickFile(file)).filter((t) => t.ts < until);
    const markets = (await loadMarkets()).filter(
      (m) => m.id === 'ASML-PERP' || m.id === 'NOVO-PERP',
    );
    const report = reportSchema.parse(
      runBacktest(ticks, {
        markets,
        params: await loadFvParams(),
        stepCapBpsPerSecond: 50,
        data: [file],
      }),
    );
    const asml = report.markets['ASML-PERP'];
    expect(asml?.opens).toBe(5);
    expect(asml?.all.n).toBeGreaterThan(100);
    // Window B (Tradegate before the open) knows far more than yesterday's close.
    expect(asml?.byWindow.B.improvement).toBeGreaterThan(0.1);
    expect(report.markets['NOVO-PERP']?.opens).toBe(5); // DKK line converted via EURDKK
  }, 120_000);
});
