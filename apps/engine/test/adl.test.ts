import { describe, expect, it } from 'vitest';
import { usdc } from '@euroedge/fixed';
import { SYSTEM } from '@euroedge/ledger';
import { insuranceThenHouse } from '../src/core/adl.ts';
import { data, Harness, listASML, order, USDC } from './fixtures.ts';

/** A venue whose insurance fund is tiny, so a gap exhausts it. */
function thinFund(): Harness {
  const h = new Harness();
  h.run(
    {
      type: 'GenesisCapital',
      house: usdc(50_000_000n * USDC),
      insurance: usdc(10n * USDC),
      source: 'dev',
    },
    listASML,
    data(70_000n),
  );
  for (let i = 0; i < 5; i++) {
    h.run({ type: 'DevDeposit', account: `t${i}`, amount: usdc(2_000n * USDC) });
    h.run(order(`t${i}`, 'buy', 1_350n));
  }
  return h;
}

describe('AdlPolicy (M4-30)', () => {
  it('splits a shortfall: fund first, house for the rest', () => {
    const h = thinFund();
    expect(insuranceThenHouse.cover(h.state, 4n * USDC)).toEqual({
      insurance: 4n * USDC,
      house: 0n,
    });
    expect(insuranceThenHouse.cover(h.state, 25n * USDC)).toEqual({
      insurance: 10n * USDC,
      house: 15n * USDC,
    });
  });

  it('a gap that exhausts the fund no longer fail-stops: the house backstops, CB7 trips', () => {
    const h = thinFund();
    const out = h.run(data(52_500n)); // −25 %: ≈ 360 USDC shortfall per account
    const liq = out.filter((o) => o.type === 'Liquidated');
    expect(liq).toHaveLength(5);
    expect(liq.some((o) => o.type === 'Liquidated' && (o.houseCover ?? 0n) > 0n)).toBe(true);
    expect(h.state.ledger.balance(SYSTEM.insurance)).toBeGreaterThanOrEqual(0n);
    expect(h.state.capitalFloor).toBe(true); // insurance < 20 % of genesis
  });
});
