import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ticks, usdc } from '@euroedge/fixed';
import {
  initialMargin,
  liquidationPenalty,
  liquidationPrice,
  maintenanceMargin,
  notionalUsdc,
} from './margin.ts';
import { houseQuote, withinPriceLimit } from './quote.ts';

const TV = usdc(100n); // ADR-0016 stock tick value

describe('margin', () => {
  it('worked example: 1.50 ASML @ €700 at 5x', () => {
    const n = notionalUsdc(150n, ticks(70_000n), TV);
    expect(n).toBe(1_050_000_000n); // 1050 USDC
    expect(initialMargin(n, 5n)).toBe(210_000_000n);
    expect(maintenanceMargin(n, 1000n)).toBe(105_000_000n); // 10 % = 50 % of IM at 5x (ESMA close-out)
    expect(liquidationPenalty(n, 100n)).toBe(10_500_000n);
    expect(() => initialMargin(n, 0n)).toThrow(/reduce-only/);
  });

  it('rounds margins up (property)', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 15n }),
        fc.bigInt({ min: 1n, max: 20n }),
        fc.bigInt({ min: 1n, max: 5000n }),
        (n, lev, mm) => {
          expect(initialMargin(usdc(n), lev) * lev >= n).toBe(true);
          expect(maintenanceMargin(usdc(n), mm) * 10_000n >= n * mm).toBe(true);
        },
      ),
    );
  });

  it('liquidation price: equity equals maintenance margin there', () => {
    // Long 1.00 @ 700 with 140 USDC cash (5x): liq ≈ 700 − (140 − 70)/0.9 … solve exactly
    const p = liquidationPrice(usdc(140_000_000n), 100n, 7_000_000n, TV, 1000n);
    expect(p).toBeDefined();
    const at = (px: bigint) =>
      140_000_000n +
      (px * 100n - 7_000_000n) * 100n -
      maintenanceMargin(notionalUsdc(100n, ticks(px), TV), 1000n);
    expect(at(p ?? 0n)).toBeGreaterThanOrEqual(0n);
    expect(at((p ?? 0n) - 1n)).toBeLessThan(0n);
    const short = liquidationPrice(usdc(140_000_000n), -100n, -7_000_000n, TV, 1000n);
    expect(short).toBeGreaterThan(70_000n);
    expect(liquidationPrice(usdc(1n), 0n, 0n, TV, 1000n)).toBeUndefined();
    // Over-collateralized long can never be liquidated at a positive price.
    expect(liquidationPrice(usdc(10_000_000_000n), 100n, 7_000_000n, TV, 1000n)).toBeUndefined();
  });
});

describe('house quote and price limit', () => {
  it('quotes FV ∓ half-spread, rounded in the house’s favour', () => {
    expect(houseQuote(ticks(70_001n), 5n)).toEqual({ bid: 69_965n, ask: 70_037n });
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: 10n ** 9n }),
        fc.bigInt({ min: 0n, max: 500n }),
        (fv, h) => {
          const q = houseQuote(ticks(fv), h);
          expect(q.bid <= fv && fv <= q.ask).toBe(true);
          expect((q.ask - q.bid) * 10_000n >= 2n * h * fv - 20_000n).toBe(true);
        },
      ),
    );
  });

  it('checks priceLimit against the index', () => {
    expect(withinPriceLimit(ticks(77_000n), ticks(70_000n), 1000n)).toBe(true);
    expect(withinPriceLimit(ticks(77_001n), ticks(70_000n), 1000n)).toBe(false);
    expect(withinPriceLimit(ticks(63_000n), ticks(70_000n), 1000n)).toBe(true);
  });
});
