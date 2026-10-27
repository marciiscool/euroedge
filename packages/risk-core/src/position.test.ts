import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { lots, ticks } from '@euroedge/fixed';
import { applyFill, averageEntry, FLAT, unrealized, type Position } from './position.ts';

describe('applyFill — worked examples (ticks of €0.01, lots of 0.01 share)', () => {
  it('opens, adds, partially closes and closes a long', () => {
    // Buy 1.00 share @ 700.00, buy 0.50 @ 703.00 → cost = 100·70000 + 50·70300 = 10 515 000
    let r = applyFill(FLAT, lots(100n), ticks(70_000n));
    r = applyFill(r.position, lots(50n), ticks(70_300n));
    expect(r.position).toEqual({ lots: 150n, cost: 10_515_000n });
    expect(averageEntry(r.position)).toBe(70_100n);
    // Sell 0.50 @ 710.00: removed cost = 10 515 000 · 50/150 = 3 505 000; realized = 3 550 000 − 3 505 000
    r = applyFill(r.position, lots(-50n), ticks(71_000n));
    expect(r.realized).toBe(45_000n); // ticks·lots → × 100 µUSDC = 4.50 USDC
    expect(r.position).toEqual({ lots: 100n, cost: 7_010_000n });
    r = applyFill(r.position, lots(-100n), ticks(69_000n));
    expect(r.realized).toBe(6_900_000n - 7_010_000n);
    expect(r.position).toEqual(FLAT);
  });

  it('truncates removed cost toward zero and keeps the residue in the position', () => {
    // 3 lots with cost 100 → close 1: removed = trunc(100/3) = 33, remaining cost 67
    const r = applyFill({ lots: 3n, cost: 100n }, lots(-1n), ticks(40n));
    expect(r.realized).toBe(40n - 33n);
    expect(r.position).toEqual({ lots: 2n, cost: 67n });
  });

  it('flips a position at the fill price', () => {
    const r = applyFill({ lots: 100n, cost: 7_000_000n }, lots(-150n), ticks(71_000n));
    expect(r.closed).toBe(100n);
    expect(r.realized).toBe(7_100_000n - 7_000_000n);
    expect(r.position).toEqual({ lots: -50n, cost: -3_550_000n });
    expect(averageEntry(r.position)).toBe(71_000n);
  });

  it('handles shorts symmetrically', () => {
    let r = applyFill(FLAT, lots(-100n), ticks(70_000n));
    expect(unrealized(r.position, ticks(69_000n))).toBe(100_000n); // short gains when price falls
    r = applyFill(r.position, lots(100n), ticks(69_000n));
    expect(r.realized).toBe(100_000n);
    expect(r.position).toEqual(FLAT);
  });

  it('zero quantity is a no-op', () => {
    expect(applyFill({ lots: 5n, cost: 9n }, 0n, ticks(1n))).toEqual({
      position: { lots: 5n, cost: 9n },
      realized: 0n,
      closed: 0n,
    });
    expect(averageEntry(FLAT)).toBeUndefined();
  });
});

describe('applyFill — properties', () => {
  const fill = fc.record({
    qty: fc.bigInt({ min: -500n, max: 500n }).filter((q) => q !== 0n),
    price: fc.bigInt({ min: 1n, max: 200_000n }),
  });

  it('a round trip to flat realizes exactly −Σ price·qty (cost basis conserved, no drift)', () => {
    fc.assert(
      fc.property(
        fc.array(fill, { minLength: 1, maxLength: 40 }),
        fc.bigInt({ min: 1n, max: 200_000n }),
        (fills, exitPx) => {
          let pos: Position = FLAT;
          let realized = 0n;
          let cash = 0n;
          for (const f of fills) {
            const r = applyFill(pos, f.qty, ticks(f.price));
            pos = r.position;
            realized += r.realized;
            cash -= f.price * f.qty;
          }
          const last = applyFill(pos, -pos.lots, ticks(exitPx));
          cash -= exitPx * -pos.lots;
          expect(last.position).toEqual(FLAT);
          expect(realized + last.realized).toBe(cash);
        },
      ),
    );
  });

  it('realized + unrealized after a fill equals unrealized before it, at the fill price', () => {
    fc.assert(
      fc.property(fc.array(fill, { maxLength: 20 }), fill, (fills, f) => {
        let pos: Position = FLAT;
        for (const x of fills) pos = applyFill(pos, x.qty, ticks(x.price)).position;
        const before = unrealized(pos, ticks(f.price));
        const r = applyFill(pos, f.qty, ticks(f.price));
        expect(r.realized + unrealized(r.position, ticks(f.price))).toBe(before);
      }),
    );
  });
});
