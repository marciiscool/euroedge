import { SYSTEM } from '@euroedge/ledger';
import { houseEquity } from './accounting.ts';
import type { EngineOutput } from './outputs.ts';
import type { EngineState } from './state.ts';

/** CB7 thresholds as a share of genesis capital (ADR-0013). */
export const CB7_TRIGGER_BPS = 2_000n;
export const CB7_RELEASE_BPS = 3_000n;

const below = (v: bigint, genesis: bigint, bps: bigint) => v * 10_000n < genesis * bps;
// A leg without genesis capital never blocks the release.
const above = (v: bigint, genesis: bigint, bps: bigint) =>
  genesis === 0n || v * 10_000n > genesis * bps;

/**
 * CB7 capital floor (ADR-0013), evaluated after every event: global reduce-only once house
 * equity (cash + uPnL at mark) or the insurance balance falls below 20 % of its genesis
 * amount; released only when both are above 30 % again (hysteresis).
 */
export function evaluateCapitalFloor(state: EngineState): EngineOutput[] {
  const g = state.genesisCapital;
  if (g === null) return [];
  const house = houseEquity(state) as bigint;
  const insurance = state.ledger.balance(SYSTEM.insurance) as bigint;
  const trip =
    below(house, g.house, CB7_TRIGGER_BPS) || below(insurance, g.insurance, CB7_TRIGGER_BPS);
  const clear =
    above(house, g.house, CB7_RELEASE_BPS) && above(insurance, g.insurance, CB7_RELEASE_BPS);
  const next = state.capitalFloor ? !clear : trip;
  if (next === state.capitalFloor) return [];
  state.capitalFloor = next;
  return [
    { type: 'CapitalFloorChanged', active: next, houseEquity: house, insurance },
    ...[...state.markets.keys()].map((market): EngineOutput => ({ type: 'MarketChanged', market })),
  ];
}
