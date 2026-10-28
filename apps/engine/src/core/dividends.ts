import { abs, usdc } from '@euroedge/fixed';
import { SYSTEM, userAccount } from '@euroedge/ledger';
import type { EngineInput } from './events.ts';
import { liquidateUnderwater } from './liquidation.ts';
import type { EngineOutput } from './outputs.ts';
import type { EngineState } from './state.ts';

type DividendInput = Extract<EngineInput, { type: 'DividendExDate' }>;

/**
 * Dividend cash flows on the ex-date (M4-16, review gate: math). Per position:
 * gross = |lots| × grossPerShare × tickValue (µUSDC, exact); a long receives
 * ⌊gross × (10 000 − withholding) / 10 000⌋ from the house, a short pays gross to the house.
 * The house takes the exact opposite of every user flow, so the ledger stays balanced, and
 * the withholding stays with the house. The mark drops by the dividend at the same time
 * (fv-core, brief §6.1), so a short's uPnL gain offsets its payment; underwater accounts are
 * liquidated as after funding.
 */
export function applyDividend(state: EngineState, d: DividendInput): EngineOutput[] {
  const ignore = (reason: string): EngineOutput[] => [
    { type: 'InputIgnored', input: 'DividendExDate', reason },
  ];
  if (!state.genesis) return ignore('before genesis');
  const m = state.markets.get(d.market);
  if (m === undefined) return ignore('unknown market');
  const key = `${d.market}:${d.exDate}`;
  if (state.dividends.has(key)) return ignore('dividend already applied');
  state.dividends.set(key, state.ts);

  let paidToLongs = 0n;
  let paidByShorts = 0n;
  const out: EngineOutput[] = [];
  for (const acc of state.accounts.values()) {
    const lots = acc.positions.get(d.market)?.lots ?? 0n;
    if (lots === 0n) continue;
    const gross = abs(lots) * d.grossPerShare * m.units.tickValue;
    const user = userAccount(acc.id);
    if (lots > 0n) {
      const net = (gross * (10_000n - d.withholdingBps)) / 10_000n;
      if (net === 0n) continue;
      state.ledger.post([{ from: SYSTEM.house, to: user, amount: usdc(net), reason: 'dividend' }]);
      paidToLongs += net;
      out.push({
        type: 'CashFlow',
        account: acc.id,
        market: d.market,
        kind: 'dividend',
        amount: net,
      });
    } else {
      state.ledger.post([
        { from: user, to: SYSTEM.house, amount: usdc(gross), reason: 'dividend' },
      ]);
      paidByShorts += gross;
      out.push({
        type: 'CashFlow',
        account: acc.id,
        market: d.market,
        kind: 'dividend',
        amount: -gross,
      });
    }
    out.push({ type: 'AccountChanged', account: acc.id });
  }
  return [
    { type: 'DividendApplied', market: d.market, exDate: d.exDate, paidToLongs, paidByShorts },
    ...out,
    ...liquidateUnderwater(state, d.market),
  ];
}
