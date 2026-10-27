import { SYSTEM } from '@euroedge/ledger';
import { accountEquity, houseEquity } from './accounting.ts';
import type { EngineState } from './state.ts';

export class InvariantViolation extends Error {
  readonly invariant: number;

  constructor(invariant: number, message: string) {
    super(`invariant ${invariant} violated: ${message}`);
    this.name = 'InvariantViolation';
    this.invariant = invariant;
  }
}

/**
 * Runtime asserts after every event (brief §7.3, ADR-0013). A violation means the state is
 * suspect: the engine fail-stops (proposed in ADR-0013) rather than continue.
 */
export function assertInvariants(state: EngineState): void {
  const { ledger } = state;
  // 1. Σ ledger balances = net deposits (incl. genesis), exactly.
  const internal = ledger.internalTotal();
  if (internal !== state.netDeposits || internal !== ledger.netExternalInflow()) {
    throw new InvariantViolation(1, `ledger ${internal} ≠ net deposits ${state.netDeposits}`);
  }
  for (const m of state.markets.values()) {
    // 2. Σ uPnL (users + house) = 0: the house mirrors user lots and cost exactly.
    let lots = m.house.lots;
    let cost = m.house.cost;
    for (const acc of state.accounts.values()) {
      const p = acc.positions.get(m.id);
      if (p !== undefined) {
        lots += p.lots;
        cost += p.cost;
      }
    }
    if (lots !== 0n || cost !== 0n)
      throw new InvariantViolation(2, `${m.id}: Σ lots ${lots}, Σ cost ${cost}`);
    // 5. Mark within fvBand (no SNAP in M1).
    const d = m.data;
    if (d !== undefined && (d.mark < d.bandLo || d.mark > d.bandHi)) {
      throw new InvariantViolation(5, `${m.id}: mark ${d.mark} outside [${d.bandLo}, ${d.bandHi}]`);
    }
  }
  // 4. No user equity < 0; 7. Σ max(0, user equity) + max(0, house equity) + insurance ≤ vault.
  let userSum = 0n;
  for (const acc of state.accounts.values()) {
    const e = accountEquity(state, acc.id);
    if (e < 0n) throw new InvariantViolation(4, `account ${acc.id} equity ${e}`);
    userSum += e;
  }
  const house = houseEquity(state);
  const insurance = ledger.balance(SYSTEM.insurance);
  if (state.genesis) {
    if (house < 0n) throw new InvariantViolation(8, `house equity ${house}`);
    if (insurance < 0n) throw new InvariantViolation(9, `insurance ${insurance}`);
  }
  const lhs = userSum + (house > 0n ? house : 0n) + insurance;
  if (lhs > internal) throw new InvariantViolation(7, `claims ${lhs} > vault ${internal}`);
}
