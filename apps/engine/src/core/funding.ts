import { usdc } from '@euroedge/fixed';
import { SYSTEM, userAccount, type Posting } from '@euroedge/ledger';
import {
  fundingIndexDelta,
  fundingRatePerHour,
  MS_PER_HOUR,
  settleFunding,
} from '@euroedge/risk-core';
import { accountEquity } from './accounting.ts';
import type { AccountId } from './events.ts';
import { liquidateUnderwater } from './liquidation.ts';
import type { EngineOutput } from './outputs.ts';
import type { AccountState, EngineState, FundingAccrual, MarketState } from './state.ts';

/**
 * Funding (ADR-0016, ADR-0018): each market's index grows with event time at the current
 * mark and hourly rate; every holder (users and the house) settles at each UTC hour.
 * Unsettled funding is not part of equity until it settles.
 */

/** Current total hourly rate of a market (Rate per hour; > 0 longs pay). */
export function marketFundingRate(m: MarketState): bigint {
  const d = m.data;
  if (d === undefined) return 0n;
  const w = m.windows[d.window];
  return fundingRatePerHour({
    interestBpsPerYear: m.fundingInterestBpsPerYear,
    capPpmPerHour: w.fundingCapPpmPerHour,
    oiCap: w.fundingOiCap,
    // User long − user short notional = −house lots at mark.
    netSkew: -m.house.lots * d.mark * m.units.tickValue,
    quantoDrift: m.funding.quantoDrift,
  });
}

/** Advances the index to `ts` at the mark and rate in force since the last advance. */
function accrue(m: MarketState, ts: bigint): void {
  const f = m.funding;
  if (m.data !== undefined && ts > f.lastTs) {
    f.index += fundingIndexDelta(
      m.data.mark,
      m.units.tickValue,
      marketFundingRate(m),
      ts - f.lastTs,
    );
  }
  if (ts > f.lastTs) f.lastTs = ts;
}

const owed = (a: FundingAccrual | undefined, lots: bigint, index: bigint): bigint =>
  a === undefined ? 0n : a.pending + lots * (index - a.snap);

const roll = (a: FundingAccrual | undefined, lots: bigint, index: bigint): FundingAccrual => ({
  snap: index,
  pending: owed(a, lots, index),
});

/** Must run before an account's (and the mirrored house) lots in `m` change. */
export function checkpointFunding(m: MarketState, acc: AccountState): void {
  const i = m.funding.index;
  acc.funding.set(m.id, roll(acc.funding.get(m.id), acc.positions.get(m.id)?.lots ?? 0n, i));
  m.funding.house = roll(m.funding.house, m.house.lots, i);
}

/**
 * Brings funding up to event time `ts`: settles every whole UTC hour passed since the last
 * event (accruing exactly to the boundary first), then accrues to `ts`.
 */
export function advanceFunding(state: EngineState, ts: bigint): EngineOutput[] {
  const out: EngineOutput[] = [];
  if (state.fundingNextTs === 0n) state.fundingNextTs = (ts / MS_PER_HOUR + 1n) * MS_PER_HOUR;
  while (state.fundingNextTs <= ts) {
    const hour = state.fundingNextTs;
    for (const m of state.markets.values()) accrue(m, hour);
    for (const m of state.markets.values()) out.push(...settleMarket(state, m, hour));
    state.fundingNextTs = hour + MS_PER_HOUR;
  }
  for (const m of state.markets.values()) accrue(m, ts);
  return out;
}

function settleMarket(state: EngineState, m: MarketState, hour: bigint): EngineOutput[] {
  const index = m.funding.index;
  const holders: AccountId[] = [];
  const due: bigint[] = [];
  for (const acc of state.accounts.values()) {
    const a = acc.funding.get(m.id);
    if (a === undefined) continue;
    const lots = acc.positions.get(m.id)?.lots ?? 0n;
    const d = owed(a, lots, index);
    if (lots === 0n) acc.funding.delete(m.id);
    else acc.funding.set(m.id, { snap: index, pending: 0n });
    if (d !== 0n) {
      holders.push(acc.id);
      due.push(d);
    }
  }
  const houseDue = owed(m.funding.house, m.house.lots, index);
  m.funding.house = { snap: index, pending: 0n };
  if (houseDue === 0n && holders.length === 0) return [];

  const { payments, residue } = settleFunding([...due, houseDue]);
  const clearing = SYSTEM.fundingClearing;
  const postings: Posting[] = [];
  const transfer = (from: string, to: string, amount: bigint, reason: Posting['reason']) => {
    if (amount > 0n) postings.push({ from, to, amount: usdc(amount), reason });
  };
  let paid = 0n;
  let received = 0n;
  let cover = 0n;
  holders.forEach((id, k) => {
    const p = payments[k] ?? 0n;
    const user = userAccount(id);
    if (p < 0n) {
      transfer(clearing, user, -p, 'funding');
      received += -p;
      return;
    }
    // Negative-balance protection: a payer never pays beyond its equity; insurance covers.
    const equity = accountEquity(state, id) as bigint;
    const charged = equity <= 0n ? 0n : p < equity ? p : equity;
    transfer(user, clearing, charged, 'funding');
    paid += p;
    cover += p - charged;
  });
  const houseP = payments[holders.length] ?? 0n;
  if (houseP > 0n) {
    transfer(SYSTEM.house, clearing, houseP, 'funding');
    paid += houseP;
  } else {
    transfer(clearing, SYSTEM.house, -houseP, 'funding');
    received += -houseP;
  }
  transfer(SYSTEM.insurance, clearing, cover, 'insurance-cover');
  transfer(clearing, SYSTEM.fees, residue, 'funding');
  state.ledger.post(postings);

  return [
    {
      type: 'FundingSettled',
      market: m.id,
      hourTs: hour,
      ratePerHour: marketFundingRate(m),
      paid: usdc(paid),
      received: usdc(received),
      residue: usdc(residue),
      insuranceCover: usdc(cover),
    },
    ...holders.map((account): EngineOutput => ({ type: 'AccountChanged', account })),
    ...liquidateUnderwater(state, m.id),
  ];
}
