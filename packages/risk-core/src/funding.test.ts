import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  FUNDING_INDEX_SCALE,
  fundingIndexDelta,
  fundingRatePerHour,
  interestRatePerHour,
  settleFunding,
} from './funding.ts';

const A = { interestBpsPerYear: 500n, capPpmPerHour: 300n, oiCap: 2_000_000_000_000n };

describe('funding rate (ADR-0016)', () => {
  it('interest is 5 % p.a. per hour, longs pay', () => {
    expect(interestRatePerHour(500n)).toBe(5_707_762_557_077n);
    expect(interestRatePerHour(0n)).toBe(0n);
  });

  it('is monotone in skew and never exceeds the cap on the total', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(10n ** 13n), max: 10n ** 13n }),
        fc.bigInt({ min: 0n, max: 10n ** 12n }),
        (s, d) => {
          const r1 = fundingRatePerHour({ ...A, netSkew: s, quantoDrift: 0n });
          const r2 = fundingRatePerHour({ ...A, netSkew: s + d, quantoDrift: 0n });
          expect(r2 >= r1).toBe(true);
          expect(r1 <= 300_000_000_000_000n && r1 >= -300_000_000_000_000n).toBe(true);
        },
      ),
    );
  });

  it('without a cap (Window D) is interest + quantoDrift, unclamped', () => {
    const r = fundingRatePerHour({
      interestBpsPerYear: 500n,
      capPpmPerHour: null,
      oiCap: 1n,
      netSkew: 10n ** 15n,
      quantoDrift: 7n,
    });
    expect(r).toBe(5_707_762_557_084n);
  });

  it('a missing OI cap means no skew term, but the cap still applies', () => {
    const r = fundingRatePerHour({
      ...A,
      oiCap: null,
      netSkew: 10n ** 15n,
      quantoDrift: 10n ** 18n,
    });
    expect(r).toBe(300_000_000_000_000n);
  });
});

describe('funding settlement (ADR-0018)', () => {
  it('is exact in the index and zero-sum up to a non-negative residue', () => {
    fc.assert(
      fc.property(
        fc.array(fc.bigInt({ min: -50_000n, max: 50_000n }), { minLength: 1, maxLength: 12 }),
        fc.bigInt({ min: 1n, max: 200_000n }),
        fc.bigInt({ min: -(3n * 10n ** 14n), max: 3n * 10n ** 14n }),
        fc.bigInt({ min: 1n, max: 7_200_000n }),
        (users, mark, rate, dt) => {
          const lots = [...users, -users.reduce((a, b) => a + b, 0n)]; // house mirrors users
          const dI = fundingIndexDelta(mark, 100n, rate, dt);
          const due = lots.map((l) => l * dI);
          expect(due.reduce((a, b) => a + b, 0n)).toBe(0n);
          const { payments, residue } = settleFunding(due);
          expect(residue).toBe(payments.reduce((a, b) => a + b, 0n));
          expect(residue >= 0n).toBe(true);
          // Each payment is within 1 µUSDC of the exact amount, rounded against the holder.
          payments.forEach((p, k) => {
            const exact = due[k] ?? 0n;
            expect(p * FUNDING_INDEX_SCALE >= exact).toBe(true);
            expect((p - 1n) * FUNDING_INDEX_SCALE < exact).toBe(true);
          });
          expect(residue <= BigInt(lots.length)).toBe(true);
        },
      ),
    );
  });

  it('a holder that owes nothing pays nothing', () => {
    expect(settleFunding([0n]).payments).toEqual([0n]);
  });
});
