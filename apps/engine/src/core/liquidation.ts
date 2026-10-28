import { usdc } from '@euroedge/fixed';
import { SYSTEM, userAccount, type Posting } from '@euroedge/ledger';
import { applyFill, FLAT, liquidationPenalty, notionalUsdc } from '@euroedge/risk-core';
import { accountEquity, accountMaintenance } from './accounting.ts';
import type { MarketId } from './events.ts';
import type { EngineOutput } from './outputs.ts';
import type { EngineState } from './state.ts';

/**
 * Liquidates every account holding `market` whose equity is below maintenance margin:
 * partial first (just enough of this market's position to restore equity to MM × (1 + buffer)),
 * full otherwise. The house takes positions at mark; the penalty (ADR-0016) goes to insurance;
 * any shortfall is covered by insurance so no user balance stays negative.
 * The 3-min VWAP liquidation price after a snap (brief §6.4) is still to come.
 */
export function liquidateUnderwater(state: EngineState, market: MarketId): EngineOutput[] {
  const out: EngineOutput[] = [];
  for (const acc of state.accounts.values()) {
    const pos = acc.positions.get(market);
    if (pos === undefined || pos.lots === 0n) continue;
    if (accountEquity(state, acc.id) >= accountMaintenance(state, acc.id)) continue;
    const partial = liquidatePartially(state, acc.id, market);
    if (
      partial !== undefined &&
      accountEquity(state, acc.id) >= accountMaintenance(state, acc.id)
    ) {
      out.push(...partial);
      continue;
    }
    if (partial !== undefined) out.push(...partial);
    out.push(...liquidateFully(state, acc.id));
  }
  return out;
}

const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

/**
 * Closes the fewest lots k of `market` at mark so that, after the penalty on k,
 * equity ≥ MM × (1 + buffer). Returns undefined when that is impossible or would leave
 * less than the minimum notional (→ full liquidation).
 *   k·a·(T·mm − pen·10⁴) ≥ T·MM·10⁴ − E·10⁸,  a = mark·tickValue, T = 10⁴ + buffer.
 */
function liquidatePartially(
  state: EngineState,
  account: string,
  market: MarketId,
): EngineOutput[] | undefined {
  const m = state.markets.get(market);
  const acc = state.accounts.get(account);
  const pos = acc?.positions.get(market);
  if (
    m?.data === undefined ||
    acc === undefined ||
    pos === undefined ||
    m.partialLiquidationBufferBps === null
  )
    return undefined;
  const equity = accountEquity(state, account) as bigint;
  if (equity <= 0n) return undefined;
  const mark = m.data.mark;
  const a = mark * m.units.tickValue;
  const T = 10_000n + m.partialLiquidationBufferBps;
  const denom = a * (T * m.maintenanceMarginBps - m.liquidationPenaltyBps * 10_000n);
  const need = T * (accountMaintenance(state, account) as bigint) * 10_000n - equity * 100_000_000n;
  if (denom <= 0n || need <= 0n) return undefined;
  const absL = pos.lots < 0n ? -pos.lots : pos.lots;
  const k = ceilDiv(need, denom);
  if (k >= absL || (absL - k) * a < m.minNotional) return undefined;

  const qty = pos.lots > 0n ? -k : k;
  const r = applyFill(pos, qty, mark);
  const user = userAccount(account);
  const realized = r.realized * m.units.tickValue;
  const postings: Posting[] = [];
  if (realized > 0n)
    postings.push({ from: SYSTEM.house, to: user, amount: usdc(realized), reason: 'realized-pnl' });
  if (realized < 0n)
    postings.push({
      from: user,
      to: SYSTEM.house,
      amount: usdc(-realized),
      reason: 'realized-pnl',
    });
  if (postings.length > 0) state.ledger.post(postings);
  m.house = { lots: m.house.lots - qty, cost: m.house.cost - (r.position.cost - pos.cost) };
  acc.positions.set(market, r.position);
  const penalty = liquidationPenalty(
    notionalUsdc(qty, mark, m.units.tickValue),
    m.liquidationPenaltyBps,
  );
  const cash = state.ledger.balance(user) as bigint;
  const charged = cash <= 0n ? 0n : penalty < cash ? penalty : cash;
  if (charged > 0n)
    state.ledger.post([
      { from: user, to: SYSTEM.insurance, amount: usdc(charged), reason: 'liquidation-penalty' },
    ]);
  return [
    {
      type: 'Liquidated',
      account,
      markets: [market],
      penalty: usdc(charged),
      insuranceCover: usdc(0n),
      partial: true,
      closedLots: k,
    },
    { type: 'AccountChanged', account },
  ];
}

/** Closes every position of the account at mark (the M1 behaviour, now the fallback). */
function liquidateFully(state: EngineState, account: string): EngineOutput[] {
  const out: EngineOutput[] = [];
  const acc = state.accounts.get(account);
  if (acc === undefined) return out;
  {
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
        partial: false,
      },
      { type: 'AccountChanged', account: acc.id },
    );
  }
  return out;
}
