import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { band, combine, type Signal } from './combine.ts';

interface Case {
  name: string;
  anchor: number;
  signals: Signal[];
  params: { stalenessBp2PerSecond: number; phi: number; sigmaFloorBp: number; bandSigmas: number };
  expected: {
    weights: number[];
    s: number;
    sigma: number;
    fv: number;
    bandLo: number;
    bandHi: number;
  };
}

describe('golden vectors: fair value (docs/methodology/examples/fair-value.json)', () => {
  it('matches every hand-derived case', async () => {
    const f = JSON.parse(
      await readFile(
        new URL('../../../docs/methodology/examples/fair-value.json', import.meta.url),
        'utf8',
      ),
    ) as { cases: Case[] };
    for (const c of f.cases) {
      const r = combine(c.signals, c.params);
      if (r === undefined) throw new Error(c.name);
      const fv = c.anchor * Math.exp(r.s);
      const [lo, hi] = band(fv, r.sigma, c.params.bandSigmas);
      r.signals.forEach((x, i) => expect(x.weight).toBeCloseTo(c.expected.weights[i] ?? NaN, 12));
      expect(r.s).toBeCloseTo(c.expected.s, 12);
      expect(r.sigma).toBeCloseTo(c.expected.sigma, 12);
      expect(fv).toBeCloseTo(c.expected.fv, 9);
      expect(lo).toBeCloseTo(c.expected.bandLo, 9);
      expect(hi).toBeCloseTo(c.expected.bandHi, 9);
    }
  });
});
