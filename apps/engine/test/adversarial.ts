import { lots, ticks, usdc } from '@euroedge/fixed';
import { Rng } from '@euroedge/data-adapters';
import { loadMarkets, loadWindows } from '@euroedge/shared/config';
import { accountEquity } from '../src/core/accounting.ts';
import { apply } from '../src/core/apply.ts';
import type { EngineInput } from '../src/core/events.ts';
import type { EngineOutput } from '../src/core/outputs.ts';
import { createState, type EngineState } from '../src/core/state.ts';
import { EVENT_VERSIONS } from '../src/log/codec.ts';
import { executablePrice } from '../src/core/quote.ts';
import { marketListedInput } from '../src/market-config.ts';
import { listASML } from './fixtures.ts';

/**
 * Adversarial simulations (M4-25/26) on the engine core, shared by the tests and the
 * `bench:adversarial` report. Prices follow a seeded random walk; market data is the only
 * thing that moves the mark.
 */
export const USDC = 1_000_000n;

export class Sim {
  readonly state: EngineState = createState();
  private seq = 0n;
  px = 70_000n;
  outputs: EngineOutput[] = [];

  run(input: EngineInput): EngineOutput[] {
    this.seq += 1n;
    const out = apply(this.state, {
      seq: this.seq,
      ts: 1_793_000_000_000n + this.seq * 1_000n,
      v: EVENT_VERSIONS[input.type],
      input,
    });
    this.outputs.push(...out);
    return out;
  }

  data(px = this.px): EngineOutput[] {
    this.px = px;
    const half = px / 100n; // ±1 % band
    return this.run({
      type: 'MarketData',
      market: 'ASML-PERP',
      window: 'A',
      fv: ticks(px),
      bandLo: ticks(px - half),
      bandHi: ticks(px + half),
      index: ticks(px),
      mark: ticks(px),
      markClamped: false,
      sigmaPpm: 1_000n,
      breaker: 'none',
    });
  }

  order(account: string, side: 'buy' | 'sell', qty: bigint, reduceOnly = false): EngineOutput[] {
    return this.run({
      type: 'PlaceOrder',
      requestId: `r${this.seq}`,
      idempotencyKey: `k${this.seq}`,
      account,
      market: 'ASML-PERP',
      side,
      qty: lots(qty),
      reduceOnly,
    });
  }
}

/** Quote configs to compare: the M1 quote (half-spread only) and windows.yaml (ADR-0019). */
export async function listing(config: 'm1' | 'adr-0019'): Promise<EngineInput> {
  if (config === 'm1') return listASML;
  const [asml] = await loadMarkets();
  if (asml === undefined) throw new Error('no ASML config');
  return marketListedInput(asml, await loadWindows());
}

export async function boot(config: 'm1' | 'adr-0019'): Promise<Sim> {
  const s = new Sim();
  s.run({
    type: 'GenesisCapital',
    house: usdc(50_000_000n * USDC),
    insurance: usdc(5_000_000n * USDC),
    source: 'dev',
  });
  s.run(await listing(config));
  s.data();
  return s;
}

/**
 * Informed arbitrageur (M4-25): knows the next FV. Buys when it beats the ask, sells when
 * below the bid, and closes one tick later. Returns its PnL per €1M traded and per €1M of
 * average open interest per hour — the house's cost of fully toxic flow. With σ ≈ 20 bp per
 * 1-s tick and perfect foresight this is an extreme upper bound, for comparing quote configs.
 */
export async function informedArbitrage(config: 'm1' | 'adr-0019', steps = 2_000, seed = 11) {
  const s = await boot(config);
  const rng = new Rng(seed);
  s.run({ type: 'DevDeposit', account: 'arb', amount: usdc(1_000_000n * USDC) });
  const start = accountEquity(s.state, 'arb') as bigint;
  let traded = 0n;
  let oiSum = 0n;
  const size = 1_000n; // 10 shares ≈ €7 000 per trade
  let next = s.px;
  const step = () => {
    const sigma = 0.002; // ≈ 20 bp per tick
    return BigInt(Math.max(1_000, Math.round(Number(next) * (1 + sigma * rng.normal()))));
  };
  next = step();
  for (let i = 0; i < steps; i++) {
    const pos = s.state.accounts.get('arb')?.positions.get('ASML-PERP')?.lots ?? 0n;
    if (pos !== 0n) s.order('arb', pos > 0n ? 'sell' : 'buy', pos < 0n ? -pos : pos, true);
    // The house's executable prices for this size, the same function fills use.
    const m = s.state.markets.get('ASML-PERP');
    if (m === undefined) throw new Error('no market');
    const ask = executablePrice(m, size, s.state.ts) ?? s.px;
    const bid = executablePrice(m, -size, s.state.ts) ?? s.px;
    const fill = (side: 'buy' | 'sell') => {
      const out = s.order('arb', side, size);
      const f = out.find((o) => o.type === 'OrderFilled');
      if (f?.type === 'OrderFilled') traded += size * f.fill.price;
    };
    // Trade only when the known next FV beats the quote by more than both taker fees (2 × 5 bp).
    if (next * 10_000n > ask * 10_010n) fill('buy');
    else if (next * 10_000n < bid * 9_990n) fill('sell');
    const held = s.state.accounts.get('arb')?.positions.get('ASML-PERP')?.lots ?? 0n;
    oiSum += (held < 0n ? -held : held) * s.px;
    s.data(next);
    next = step();
  }
  const pnl = (accountEquity(s.state, 'arb') as bigint) - start;
  const tv = s.state.markets.get('ASML-PERP')?.units.tickValue ?? 1n;
  const tradedUsdc = traded * tv;
  const avgOi = (oiSum * tv) / BigInt(steps);
  const per1m = (x: bigint) => (x === 0n ? 0 : Number((pnl * 1_000_000n * USDC) / x) / 1e6);
  return {
    config,
    fills: s.outputs.filter((o) => o.type === 'OrderFilled').length,
    pnlUsdc: Number(pnl) / 1e6,
    pnlPerMillionTraded: per1m(tradedUsdc),
    // Per €1M of average arb OI and per hour of simulated time (one tick = 1 s).
    pnlPerMillionOiPerHour: avgOi === 0n ? 0 : (per1m(avgOi) * 3_600) / steps,
  };
}

/**
 * Whale (M4-26): one huge account trades as hard as it can while smaller accounts sit just
 * above maintenance. Trades never move the mark (only market data does), so the whale must
 * not be able to liquidate anyone.
 */
export async function whale(config: 'm1' | 'adr-0019', rounds = 200, seed = 5) {
  const s = await boot(config);
  const rng = new Rng(seed);
  for (let i = 0; i < 20; i++) {
    const a = `small${i}`;
    s.run({ type: 'DevDeposit', account: a, amount: usdc(2_000n * USDC) });
    s.order(a, i % 2 === 0 ? 'buy' : 'sell', 1_350n); // ≈ 4.7×
  }
  s.run({ type: 'DevDeposit', account: 'whale', amount: usdc(10_000_000n * USDC) });
  const marks = new Set<bigint>();
  let whaleFills = 0;
  for (let i = 0; i < rounds; i++) {
    const side = rng.uniform() < 0.5 ? 'buy' : 'sell';
    const out = s.order('whale', side, BigInt(50_000 + Math.floor(rng.uniform() * 200_000)));
    whaleFills += out.filter((o) => o.type === 'OrderFilled').length;
    marks.add(s.state.markets.get('ASML-PERP')?.data?.mark ?? 0n);
    s.run({ type: 'ClockTick' });
  }
  return {
    config,
    whaleFills,
    distinctMarks: marks.size,
    liquidations: s.outputs.filter((o) => o.type === 'Liquidated').length,
  };
}
