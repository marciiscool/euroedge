import { describe, expect, it } from 'vitest';
import { usdc } from '@euroedge/fixed';
import { SYSTEM } from '@euroedge/ledger';
import { houseEquity } from '../src/core/accounting.ts';
import { evaluateCapitalFloor } from '../src/core/capital.ts';
import type { EngineOutput } from '../src/core/outputs.ts';
import { data, Harness, listASML, order, USDC } from './fixtures.ts';

/** Small genesis so the CB7 floors (20 % / 30 %) are reachable: house 1 000, insurance 100 USDC. */
function smallHouse(): Harness {
  const h = new Harness();
  h.run(
    {
      type: 'GenesisCapital',
      house: usdc(1_000n * USDC),
      insurance: usdc(100n * USDC),
      source: 'dev',
    },
    listASML,
    data(70_000n),
    { type: 'DevDeposit', account: 'alice', amount: usdc(10_000n * USDC) },
  );
  return h;
}

const floor = (out: EngineOutput[]) => out.filter((o) => o.type === 'CapitalFloorChanged');
const rejected = (out: EngineOutput[]) => out.find((o) => o.type === 'OrderRejected');

describe('CB7 capital floor (ADR-0013)', () => {
  it('trips below 20 % house equity, blocks new exposure globally, and releases above 30 %', () => {
    const h = smallHouse();
    h.run(order('alice', 'buy', 1_000n)); // 10 shares at 700.35: house short
    // House loses ≈ 10 USDC per EUR: at 781.00 its equity is 1 000 − 10 × 80.65 = 193.50 < 200.
    const trip = h.run(data(78_100n));
    expect(houseEquity(h.state)).toBeLessThan(200n * USDC);
    expect(floor(trip)).toMatchObject([{ active: true }]);
    expect(h.state.capitalFloor).toBe(true);

    // New exposure is rejected; reducing still fills.
    expect(rejected(h.run(order('alice', 'buy', 100n)))).toMatchObject({
      reason: 'circuit-breaker',
    });
    expect(h.run(order('alice', 'sell', 100n)).some((o) => o.type === 'OrderFilled')).toBe(true);

    // Between 20 % and 30 %: still active (hysteresis).
    h.run(data(77_400n));
    const mid = houseEquity(h.state);
    expect(mid > 200n * USDC && mid < 300n * USDC).toBe(true);
    expect(h.state.capitalFloor).toBe(true);

    // Back above 30 %: released, and opening trades work again.
    expect(floor(h.run(data(70_000n)))).toMatchObject([{ active: false }]);
    expect(h.run(order('alice', 'buy', 100n)).some((o) => o.type === 'OrderFilled')).toBe(true);
  });

  it('trips on the insurance leg too, with the same hysteresis', () => {
    const h = smallHouse();
    const move = (from: string, to: string, amount: bigint) =>
      h.state.ledger.post([{ from, to, amount: usdc(amount * USDC), reason: 'fee' }]);
    move(SYSTEM.insurance, SYSTEM.fees, 85n); // 15 USDC < 20 % of 100
    expect(floor(evaluateCapitalFloor(h.state))).toMatchObject([
      { active: true, insurance: 15n * USDC },
    ]);
    move(SYSTEM.fees, SYSTEM.insurance, 10n); // 25 %: stays on
    expect(evaluateCapitalFloor(h.state)).toEqual([]);
    move(SYSTEM.fees, SYSTEM.insurance, 10n); // 35 %: off
    expect(floor(evaluateCapitalFloor(h.state))).toMatchObject([{ active: false }]);
  });

  it('never trips with the production genesis under normal trading', () => {
    const h = Harness.booted();
    h.run(order('alice', 'buy', 1_000n), data(78_100n), data(62_000n));
    expect(h.state.capitalFloor).toBe(false);
  });
});
