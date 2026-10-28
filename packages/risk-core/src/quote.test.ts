import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ticks } from '@euroedge/fixed';
import {
  houseQuote,
  quoteLadder,
  quotePrice,
  type QuoteInputs,
  type QuoteParams,
} from './quote.ts';

const params = (o: Partial<QuoteParams> = {}): QuoteParams => ({
  halfSpreadBps: 5n,
  sigmaSpreadBps: 2_500n,
  inventorySkewBps: 5n,
  inventoryCap: 2_000_000_000_000n,
  impactBps: 5n,
  impactRef: 100_000_000_000n,
  impactAlphaHalves: 3n,
  ...o,
});
const inputs = (o: Partial<QuoteInputs> = {}): QuoteInputs => ({
  fv: ticks(70_000n),
  sigmaPpm: 800n,
  inventory: 0n,
  shiftPpm: 0n,
  spreadMultiplier: 1n,
  ...o,
});

describe('house quote model (ADR-0003)', () => {
  it('with every M4 term at zero it is exactly the M1 quote', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: 10_000_000n }),
        fc.bigInt({ min: 0n, max: 500n }),
        fc.bigInt({ min: 1n, max: 2n }),
        (fv, h, mult) => {
          const p = params({
            halfSpreadBps: h,
            sigmaSpreadBps: 0n,
            inventorySkewBps: 0n,
            impactBps: 0n,
          });
          const q = inputs({ fv: ticks(fv), spreadMultiplier: mult });
          const m1 = houseQuote(ticks(fv), h * mult);
          expect(quotePrice(p, q, 1n, 10n ** 12n)).toBe(m1.ask);
          expect(quotePrice(p, q, -1n, 10n ** 12n)).toBe(m1.bid);
        },
      ),
    );
  });

  it('is convex-monotone in size, never crossed, and the ladder uses the same function', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 12n }),
        fc.bigInt({ min: 0n, max: 10n ** 12n }),
        fc.bigInt({ min: -(4n * 10n ** 12n), max: 4n * 10n ** 12n }),
        fc.bigInt({ min: -2_000n, max: 2_000n }),
        fc.constantFrom(3n, 4n),
        (a, d, inv, shift, alpha) => {
          const p = params({ impactAlphaHalves: alpha });
          const q = inputs({ inventory: inv, shiftPpm: shift });
          expect(quotePrice(p, q, 1n, a + d) >= quotePrice(p, q, 1n, a)).toBe(true);
          expect(quotePrice(p, q, -1n, a + d) <= quotePrice(p, q, -1n, a)).toBe(true);
          expect(quotePrice(p, q, 1n, a) >= quotePrice(p, q, -1n, a)).toBe(true);
        },
      ),
    );
    const p = params();
    const q = inputs({ inventory: 500_000_000_000n });
    for (const r of quoteLadder(p, q)) {
      expect(r.ask).toBe(quotePrice(p, q, 1n, r.notional));
      expect(r.bid).toBe(quotePrice(p, q, -1n, r.notional));
    }
  });

  it('rejects an unsupported impact exponent', () => {
    expect(() => quotePrice(params({ impactAlphaHalves: 5n }), inputs(), 1n, 1n)).toThrow(/α/);
  });
});
