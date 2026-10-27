import { usdc } from '@euroedge/fixed';
import { SYSTEM, userAccount, type Posting } from '@euroedge/ledger';
import { applyFill, FLAT, liquidationPenalty, notionalUsdc } from '@euroedge/risk-core';
import { accountEquity, accountMaintenance } from './accounting.ts';
import type { MarketId } from './events.ts';
import type { EngineOutput } from './outputs.ts';
import type { EngineState } from './state.ts';

/**
 * Liquidates every account holding `market` whose equity is below maintenance margin.
 * M1 SIMPLIFICATION (needs-founder-review): full liquidation at mark. Partial-first
 * liquidation and the 3-min VWAP after a snap arrive in M4 (brief §6.4, §7.2).
 * The house takes positions at mark; the penalty (ADR-0016) goes to insurance; any
 * shortfall is covered by insurance so no user balance stays negative.
 */
export function liquidateUnderwater(state: EngineState, market: MarketId): EngineOutput[] {
  const out: EngineOutput[] = [];
  for (const acc of state.accounts.values()) {
    const pos = acc.positions.get(market);
    if (pos === undefined || pos.lots === 0n) continue;
    if (accountEquity(state, acc.id) >= accountMaintenance(state, acc.id)) continue;

    const user = userAccount(acc.id);
    const postings: Posting[] = [];
    let penalty = 0n;
    const closed: MarketId[] = [];
    for (const [id, p] of acc.positions) {
      const m = state.markets.get(id);
      if (p.lots === 0n || m?.data === undefined) continue;
      const mark = m.data.mark;
      const r = applyFill(p, -p.lots, mark);
      const realized = r.realized * m.units.tickValue;
      if (realized > 0n)
        postings.push({
          from: SYSTEM.house,
          to: user,
          amount: usdc(realized),
          reason: 'realized-pnl',
        });
      if (realized < 0n)
        postings.push({
          from: user,
          to: SYSTEM.house,
          amount: usdc(-realized),
          reason: 'realized-pnl',
        });
      m.house = { lots: m.house.lots + p.lots, cost: m.house.cost + p.cost };
      acc.positions.set(id, FLAT);
      penalty += liquidationPenalty(
        notionalUsdc(p.lots, mark, m.units.tickValue),
        m.liquidationPenaltyBps,
      );
      closed.push(id);
    }
    state.ledger.post(postings);

    const cash = state.ledger.balance(user) as bigint;
    const charged = cash <= 0n ? 0n : penalty < cash ? penalty : cash;
    if (charged > 0n) {
      state.ledger.post([
        { from: user, to: SYSTEM.insurance, amount: usdc(charged), reason: 'liquidation-penalty' },
      ]);
    }
    const shortfall = cash < 0n ? -cash : 0n;
    if (shortfall > 0n) {
      state.ledger.post([
        { from: SYSTEM.insurance, to: user, amount: usdc(shortfall), reason: 'insurance-cover' },
      ]);
    }
    out.push(
      {
        type: 'Liquidated',
        account: acc.id,
        markets: closed,
        penalty: usdc(charged),
        insuranceCover: usdc(shortfall),
      },
      { type: 'AccountChanged', account: acc.id },
    );
  }
  return out;
}
