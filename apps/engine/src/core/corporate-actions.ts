import { usdc } from '@euroedge/fixed';
import { SYSTEM, userAccount } from '@euroedge/ledger';
import type { EngineInput } from './events.ts';
import type { EngineOutput } from './outputs.ts';
import type { EngineState, MarketState } from './state.ts';

/**
 * Corporate actions (M4-17, review gate: math). PROPOSED procedure, admin-driven:
 *
 * 1. Freeze: the market's resting orders are cancelled and every user order is refused
 *    (`market-frozen`). Liquidations keep running, so no account can go below zero.
 * 2. Adjust (split num:den, one old share → num/den new shares; a reverse split has
 *    num < den): every position scales to ⌊|lots| × num / den⌋ (sign kept), its cost
 *    basis is kept pro rata, and the fraction of a lot that does not fit is cash-settled
 *    against the house at the adjusted mark. Prices in the market data scale by den/num
 *    (band outward, the rest to nearest) until fresh data arrives. The house mirror is
 *    rebuilt as −Σ users, so Invariant 2 holds exactly.
 * 3. Unfreeze: trading resumes.
 */
type Freeze = Extract<EngineInput, { type: 'CorporateActionFreeze' }>;
type Adjust = Extract<EngineInput, { type: 'CorporateActionAdjust' }>;
type Unfreeze = Extract<EngineInput, { type: 'CorporateActionUnfreeze' }>;

const ignore = (input: string, reason: string): EngineOutput[] => [
  { type: 'InputIgnored', input, reason },
];

/** Integer division rounding toward −∞ / +∞ / nearest (half away from zero). */
const floorDiv = (a: bigint, b: bigint) => (a >= 0n ? a / b : -((-a + b - 1n) / b));
const ceilDiv = (a: bigint, b: bigint) => -floorDiv(-a, b);
const roundDiv = (a: bigint, b: bigint) =>
  a >= 0n ? (2n * a + b) / (2n * b) : -((-2n * a + b) / (2n * b));

export function freezeMarket(
  state: EngineState,
  i: Freeze,
  cancelResting: (market: string) => EngineOutput[],
): EngineOutput[] {
  const m = state.markets.get(i.market);
  if (m === undefined) return ignore(i.type, 'unknown market');
  if (m.corporateAction !== null)
    return ignore(i.type, `already frozen for ${m.corporateAction.id}`);
  m.corporateAction = { id: i.actionId, adjusted: false };
  return [
    { type: 'CorporateActionChanged', market: m.id, actionId: i.actionId, stage: 'frozen' },
    ...cancelResting(m.id),
    { type: 'MarketChanged', market: m.id },
  ];
}

export function unfreezeMarket(state: EngineState, i: Unfreeze): EngineOutput[] {
  const m = state.markets.get(i.market);
  if (m === undefined) return ignore(i.type, 'unknown market');
  if (m.corporateAction?.id !== i.actionId) return ignore(i.type, 'not frozen for this action');
  m.corporateAction = null;
  return [
    { type: 'CorporateActionChanged', market: m.id, actionId: i.actionId, stage: 'unfrozen' },
    { type: 'MarketChanged', market: m.id },
  ];
}

export function adjustMarket(state: EngineState, i: Adjust): EngineOutput[] {
  const m = state.markets.get(i.market);
  if (m === undefined) return ignore(i.type, 'unknown market');
  if (m.corporateAction?.id !== i.actionId) return ignore(i.type, 'not frozen for this action');
  if (m.corporateAction.adjusted) return ignore(i.type, 'already adjusted');
  if (m.data === undefined) return ignore(i.type, 'no market data');
  const { ratioNum: num, ratioDen: den } = i;
  m.corporateAction = { id: i.actionId, adjusted: true };
  scaleData(m, num, den);
  const mark = m.data.mark;
  const out: EngineOutput[] = [
    { type: 'CorporateActionChanged', market: m.id, actionId: i.actionId, stage: 'adjusted' },
  ];
  let houseLots = 0n;
  let houseCost = 0n;
  for (const acc of state.accounts.values()) {
    const pos = acc.positions.get(m.id);
    if (pos === undefined || pos.lots === 0n) continue;
    const scaled = pos.lots * num; // exact new lots × den
    const lots = scaled / den; // toward zero
    const cost = lots === 0n ? 0n : (pos.cost * lots * den) / scaled;
    // The leftover fraction of a lot, valued at the adjusted mark, against the cost it carried.
    const residue = scaled - lots * den;
    const realized = ((residue * mark) / den - (pos.cost - cost)) * m.units.tickValue;
    acc.positions.set(m.id, { lots, cost });
    houseLots -= lots;
    houseCost -= cost;
    if (realized !== 0n) {
      const user = userAccount(acc.id);
      state.ledger.post([
        realized > 0n
          ? { from: SYSTEM.house, to: user, amount: usdc(realized), reason: 'realized-pnl' }
          : { from: user, to: SYSTEM.house, amount: usdc(-realized), reason: 'realized-pnl' },
      ]);
    }
    out.push({ type: 'AccountChanged', account: acc.id });
  }
  m.house = { lots: houseLots, cost: houseCost };
  out.push({ type: 'MarketChanged', market: m.id });
  return out;
}

/** Prices × den/num: the band outward so it still contains FV and mark. */
function scaleData(m: MarketState, num: bigint, den: bigint): void {
  const d = m.data;
  if (d === undefined) return;
  const at = (p: bigint) => roundDiv(p * den, num);
  m.data = {
    ...d,
    fv: at(d.fv) as typeof d.fv,
    mark: at(d.mark) as typeof d.mark,
    index: at(d.index) as typeof d.index,
    bandLo: floorDiv(d.bandLo * den, num) as typeof d.bandLo,
    bandHi: ceilDiv(d.bandHi * den, num) as typeof d.bandHi,
  };
}
