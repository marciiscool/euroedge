import { RATE_SCALE, usdc } from '@euroedge/fixed';
import { SYSTEM, userAccount } from '@euroedge/ledger';
import { liquidateUnderwater } from './liquidation.ts';
import type { EngineOutput } from './outputs.ts';
import type { EngineState, MarketState } from './state.ts';

export const HOUR_MS = 3_600_000n;
const HOURS_PER_YEAR = 8_760n;
const PPM_TO_RATE = RATE_SCALE / 1_000_000n;

const clamp = (x: bigint, lo: bigint, hi: bigint) => (x < lo ? lo : x > hi ? hi : x);

export interface FundingInputs {
  readonly interestBpsPerYear: bigint;
  /** null = Window D: interest only. */
  readonly capPpmPerHour: bigint | null;
  /** µUSDC. */
  readonly oiCap: bigint;
  /** Net user long − short notional at mark, µUSDC. */
  readonly netSkew: bigint;
}

/**
 * Hourly funding rate (ADR-0016), Rate units (1e18 = 100 % per hour). Positive: longs pay.
 * interest_h = bps/yr / 8760; skew_h = cap · clamp(netSkew / OIcap, −1, 1);
 * total = clamp(interest_h + skew_h, ±cap). Window D (cap null): interest only.
 */
export function hourlyFundingRate(f: FundingInputs): bigint {
  const interest = (f.interestBpsPerYear * RATE_SCALE) / (10_000n * HOURS_PER_YEAR);
  if (f.capPpmPerHour === null) return interest;
  const cap = f.capPpmPerHour * PPM_TO_RATE;
  const skew = f.oiCap === 0n ? 0n : clamp((cap * f.netSkew) / f.oiCap, -cap, cap);
  return clamp(interest + skew, -cap, cap);
}

/** Payment of one position for one hour, µUSDC, truncated toward zero. Positive = the user pays. */
export const fundingPayment = (notional: bigint, rate: bigint): bigint =>
  (notional * rate) / RATE_SCALE;

export function fundingRate(m: MarketState): bigint {
  const data = m.data;
  if (data === undefined) return 0n;
  const risk = m.windows[data.window];
  return hourlyFundingRate({
    interestBpsPerYear: m.fundingInterestBpsPerYear,
    capPpmPerHour: risk.fundingCapPpmPerHour,
    oiCap: risk.fundingOiCap,
    // Net user skew at mark = −(house notional): the house mirrors every user position.
    netSkew: -m.house.lots * data.mark * m.units.tickValue,
  });
}

/** Settles one hour: users pay (or receive) notional × rate, truncated toward zero; the house
 *  takes the exact opposite of the users' total, so funding is zero-sum by construction. */
function settleHour(state: EngineState, m: MarketState, hour: bigint): EngineOutput[] {
  const data = m.data;
  if (data === undefined) return [];
  const rate = fundingRate(m);
  m.funding.index += rate;
  m.funding.lastRate = rate;
  const out: EngineOutput[] = [{ type: 'FundingSettled', market: m.id, hour, rate }];
  for (const acc of state.accounts.values()) {
    const pos = acc.positions.get(m.id);
    if (pos === undefined || pos.lots === 0n) continue;
    const pay = fundingPayment(pos.lots * data.mark * m.units.tickValue, rate);
    if (pay === 0n) continue;
    const user = userAccount(acc.id);
    state.ledger.post([
      pay > 0n
        ? { from: user, to: SYSTEM.house, amount: usdc(pay), reason: 'funding' }
        : { from: SYSTEM.house, to: user, amount: usdc(-pay), reason: 'funding' },
    ]);
    out.push({ type: 'AccountChanged', account: acc.id });
  }
  return out;
}

/** Settles every hour boundary passed since the last settlement (event time, ADR-0001). */
export function settleFunding(state: EngineState, ts: bigint): EngineOutput[] {
  if (!state.genesis) return [];
  const hour = ts / HOUR_MS;
  const out: EngineOutput[] = [];
  for (const m of state.markets.values()) {
    if (hour <= m.funding.lastHour) continue;
    for (let h = m.funding.lastHour + 1n; h <= hour; h++) out.push(...settleHour(state, m, h));
    m.funding.lastHour = hour;
    if (out.length > 0) out.push(...liquidateUnderwater(state, m.id));
  }
  return out;
}
