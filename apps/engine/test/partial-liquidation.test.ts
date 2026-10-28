import { describe, expect, it } from 'vitest';
import { accountEquity, accountMaintenance } from '../src/core/accounting.ts';
import type { EngineInput } from '../src/core/events.ts';
import { data, Harness, listASML, order } from './fixtures.ts';

const liq = (out: ReturnType<Harness['run']>) => out.find((o) => o.type === 'Liquidated');
const lots = (h: Harness) => h.state.accounts.get('alice')?.positions.get('ASML-PERP')?.lots ?? 0n;

function levered() {
  const h = Harness.booted();
  // 70 contracts ≈ 49 000 USDC notional on 10 000 USDC: close to the 5x cap.
  h.run(order('alice', 'buy', 7_000n));
  expect(lots(h)).toBe(7_000n);
  return h;
}

describe('partial-first liquidation (M4)', () => {
  it('closes just enough to restore equity to MM × 1.25 and keeps the rest', () => {
    const h = levered();
    const out = h.run(data(61_500n)); // 615.00: equity below MM
    const l = liq(out);
    expect(l).toMatchObject({ type: 'Liquidated', partial: true, markets: ['ASML-PERP'] });
    const left = lots(h);
    expect(left).toBeGreaterThan(0n);
    expect(left).toBeLessThan(7_000n);
    const e = accountEquity(h.state, 'alice');
    const mm = accountMaintenance(h.state, 'alice');
    expect(e).toBeGreaterThanOrEqual(mm);
    // Minimal: one lot less would not have reached the target (k is the ceiling).
    expect(e * 10_000n).toBeGreaterThanOrEqual(mm * 12_500n - 7_000_000n);
  });

  it('falls back to full liquidation when a partial close cannot restore the margin', () => {
    const h = levered();
    const l = liq(h.run(data(56_000n, 'A', 6_000n))); // 560.00: equity ≈ 0
    expect(l).toMatchObject({ partial: false });
    expect(lots(h)).toBe(0n);
  });

  it('keeps full liquidation for markets listed without a buffer (v1 logs)', () => {
    const h = new Harness();
    h.run(
      {
        type: 'GenesisCapital',
        house: 50_000_000_000_000n,
        insurance: 5_000_000_000_000n,
        source: 'dev',
      } as EngineInput,
      { ...listASML, partialLiquidationBufferBps: null } as EngineInput,
      data(70_000n),
      { type: 'DevDeposit', account: 'alice', amount: 10_000_000_000n } as EngineInput,
      order('alice', 'buy', 7_000n),
    );
    expect(liq(h.run(data(61_500n)))).toMatchObject({ partial: false });
    expect(lots(h)).toBe(0n);
  });
});
