import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { bps, lots, ppm, ticks, usdc } from './types.ts';
import {
  applyBps,
  applyPpm,
  feeBps,
  lotsToQty,
  notional,
  pnl,
  priceToTicks,
  qtyToLots,
  resolveUnits,
  ticksToPrice,
} from './units.ts';

// ADR-0016 defaults.
const stock = resolveUnits({ tickSize: '0.01', lotSize: '0.01' });
const basket = resolveUnits({ tickSize: '0.01', lotSize: '0.001' });

describe('resolveUnits', () => {
  it('derives the ADR-0016 tick values', () => {
    expect(stock.tickValue).toBe(100n);
    expect(basket.tickValue).toBe(10n);
    expect(resolveUnits({ tickSize: '0.5', lotSize: '1' }).tickValue).toBe(500_000n);
  });

  it('rejects specs whose tick value is fractional µUSDC', () => {
    expect(() => resolveUnits({ tickSize: '0.0001', lotSize: '0.001' })).toThrow(/whole number/);
  });

  it('rejects non-positive sizes', () => {
    expect(() => resolveUnits({ tickSize: '0', lotSize: '1' })).toThrow(/positive/);
    expect(() => resolveUnits({ tickSize: '0.01', lotSize: '-1' })).toThrow(/positive/);
  });
});

describe('price and quantity conversion', () => {
  it('converts exactly', () => {
    expect(priceToTicks(stock, '712.35')).toBe(71_235n);
    expect(ticksToPrice(stock, ticks(71_235n))).toBe('712.35');
    expect(qtyToLots(stock, '1.5')).toBe(150n);
    expect(lotsToQty(basket, lots(1_234n))).toBe('1.234');
  });

  it('refuses off-grid values unless a rounding mode is given', () => {
    expect(() => priceToTicks(stock, '712.355')).toThrow(/not a multiple/);
    expect(priceToTicks(stock, '712.355', 'floor')).toBe(71_235n);
    expect(priceToTicks(stock, '712.355', 'ceil')).toBe(71_236n);
    expect(() => qtyToLots(stock, '0.005')).toThrow(/not a multiple/);
  });

  it('round-trips ticks → price → ticks (property)', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -(10n ** 12n), max: 10n ** 12n }), (t) => {
        expect(priceToTicks(stock, ticksToPrice(stock, ticks(t)))).toBe(t);
      }),
    );
  });
});

describe('notional and PnL', () => {
  it('worked example: 1.5 ASML long from €712.35 to €720.00', () => {
    const entry = priceToTicks(stock, '712.35');
    const exit = priceToTicks(stock, '720.00');
    const size = qtyToLots(stock, '1.5');
    // (720.00 − 712.35) × 1.5 = 11.475 EUR-points = 11.475 USDC
    expect(pnl(stock, entry, exit, size)).toBe(11_475_000n);
    expect(notional(stock, entry, size)).toBe(1_068_525_000n); // 1068.525 USDC
  });

  const t = fc.bigInt({ min: 1n, max: 10n ** 9n }).map(ticks);
  const l = fc.bigInt({ min: -(10n ** 9n), max: 10n ** 9n }).map(lots);

  it('is path independent and antisymmetric (exact, no rounding drift)', () => {
    fc.assert(
      fc.property(t, t, t, l, (a, b, c, size) => {
        expect(pnl(stock, a, b, size) + pnl(stock, b, c, size)).toBe(pnl(stock, a, c, size));
        expect(pnl(stock, a, b, size)).toBe(-pnl(stock, b, a, size));
      }),
    );
  });

  it('long and short PnL cancel (zero-sum with the house)', () => {
    fc.assert(
      fc.property(t, t, l, (a, b, size) => {
        expect(pnl(stock, a, b, size) + pnl(stock, a, b, lots(-size))).toBe(0n);
      }),
    );
  });
});

describe('fees and rates', () => {
  it('rounds fees up, never in the payer’s favour (property)', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(10n ** 15n), max: 10n ** 15n }),
        fc.bigInt({ min: 0n, max: 10_000n }),
        (amount, rate) => {
          const fee = feeBps(usdc(amount), bps(rate));
          const exactTimes10k = (amount < 0n ? -amount : amount) * rate;
          expect(fee * 10_000n >= exactTimes10k).toBe(true);
          expect((fee - 1n) * 10_000n < exactTimes10k).toBe(true);
        },
      ),
    );
  });

  it('worked example: 5 bp taker fee on 1068.525 USDC', () => {
    // 1_068_525_000 × 5 / 10_000 = 534_262.5 → 534_263 µUSDC
    expect(feeBps(usdc(1_068_525_000n), bps(5n))).toBe(534_263n);
  });

  it('applies bps and ppm with explicit rounding, preserving sign', () => {
    expect(applyBps(usdc(-1_005n), bps(5_000n), 'trunc')).toBe(-502n);
    expect(applyBps(usdc(-1_005n), bps(5_000n), 'floor')).toBe(-503n);
    expect(applyPpm(usdc(1_000_001n), ppm(500_000n), 'halfEven')).toBe(500_000n);
  });
});
