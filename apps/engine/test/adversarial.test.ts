import { describe, expect, it } from 'vitest';
import { informedArbitrage, whale } from './adversarial.ts';

describe('adversarial bots on the engine core (M4-25/26)', () => {
  it.each(['m1', 'adr-0019'] as const)(
    'a whale cannot trigger liquidations (%s quote)',
    async (q) => {
      const r = await whale(q);
      expect(r.whaleFills).toBeGreaterThan(0);
      expect(r.distinctMarks).toBe(1); // trades never move the mark
      expect(r.liquidations).toBe(0);
    },
  );

  it('measures the informed arbitrageur and the ADR-0019 quote costs it less than the M1 quote', async () => {
    const m1 = await informedArbitrage('m1');
    const proposed = await informedArbitrage('adr-0019');
    expect(m1.fills).toBeGreaterThan(50);
    expect(m1.pnlUsdc).toBeGreaterThan(0); // fully toxic flow wins against a static quote
    expect(proposed.pnlPerMillionTraded).toBeLessThan(m1.pnlPerMillionTraded);
  });
});
