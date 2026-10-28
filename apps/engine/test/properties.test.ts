import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { lots, ticks, usdc } from '@euroedge/fixed';
import { apply } from '../src/core/apply.ts';
import type { EngineEvent, EngineInput, WindowId } from '../src/core/events.ts';
import { createState } from '../src/core/state.ts';
import { decodeEvent, encodeEvent } from '../src/log/codec.ts';
import { stateDigest } from '../src/log/digest.ts';
import { replay } from '../src/log/replay.ts';
import { decodeState, encodeState } from '../src/log/state-codec.ts';
import { listASML, USDC } from './fixtures.ts';

// Two wallet accounts so withdrawals (M4-18) can succeed.
const ACCOUNTS = [
  'a',
  'b',
  'c',
  '0x000000000000000000000000000000000000000d',
  '0x000000000000000000000000000000000000000e',
];

type Step =
  | { kind: 'move'; bp: number; window: WindowId; gap: boolean }
  | { kind: 'deposit'; account: string; amount: bigint }
  | { kind: 'order'; account: string; buy: boolean; qty: bigint; reduceOnly: boolean; key: number }
  | { kind: 'close'; account: string }
  | {
      kind: 'resting';
      account: string;
      buy: boolean;
      qty: bigint;
      reduceOnly: boolean;
      key: number;
      type: 'limit' | 'stop' | 'take-profit' | 'stop-limit';
      /** Offset of the limit / trigger from the current price, bp. */
      bp: number;
      oco: number | null;
      tif: 'gtc' | 'ioc' | 'fok';
      postOnly: boolean;
    }
  | { kind: 'cancel'; account: string; key: number }
  | { kind: 'withdraw'; account: string; amount: bigint; key: number }
  | { kind: 'settle'; account: string; key: number; executed: boolean }
  | { kind: 'dividend'; gross: bigint; withholdingBps: bigint }
  | { kind: 'tick' };

const step: fc.Arbitrary<Step> = fc.oneof(
  {
    weight: 4,
    arbitrary: fc.record({
      kind: fc.constant('move' as const),
      bp: fc.integer({ min: -60, max: 60 }),
      window: fc.constantFrom<WindowId>('A', 'B', 'C', 'D'),
      gap: fc.constant(false),
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      kind: fc.constant('deposit' as const),
      account: fc.constantFrom(...ACCOUNTS),
      amount: fc.bigInt({ min: 1n, max: 20_000n * USDC }),
    }),
  },
  {
    weight: 5,
    arbitrary: fc.record({
      kind: fc.constant('order' as const),
      account: fc.constantFrom(...ACCOUNTS),
      buy: fc.boolean(),
      qty: fc.bigInt({ min: 1n, max: 30_000n }),
      reduceOnly: fc.boolean(),
      key: fc.integer({ min: 0, max: 50 }),
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      kind: fc.constant('close' as const),
      account: fc.constantFrom(...ACCOUNTS),
    }),
  },
  {
    weight: 4,
    arbitrary: fc.record({
      kind: fc.constant('resting' as const),
      account: fc.constantFrom(...ACCOUNTS),
      buy: fc.boolean(),
      qty: fc.bigInt({ min: 1n, max: 30_000n }),
      reduceOnly: fc.boolean(),
      key: fc.integer({ min: 0, max: 50 }),
      type: fc.constantFrom(
        'limit' as const,
        'stop' as const,
        'take-profit' as const,
        'stop-limit' as const,
      ),
      bp: fc.integer({ min: -150, max: 150 }),
      oco: fc.option(fc.integer({ min: 0, max: 2 })),
      // Mostly GTC and not post-only, so the generator still produces plenty of resting fills.
      tif: fc.constantFrom<'gtc' | 'ioc' | 'fok'>('gtc', 'gtc', 'gtc', 'gtc', 'gtc', 'ioc', 'fok'),
      postOnly: fc.constantFrom(false, false, false, false, true),
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      kind: fc.constant('cancel' as const),
      account: fc.constantFrom(...ACCOUNTS),
      key: fc.integer({ min: 0, max: 50 }),
    }),
  },
  { weight: 1, arbitrary: fc.constant({ kind: 'tick' as const }) },
  {
    weight: 1,
    arbitrary: fc.record({
      kind: fc.constant('dividend' as const),
      gross: fc.bigInt({ min: 1n, max: 1_500n }),
      withholdingBps: fc.bigInt({ min: 0n, max: 3_500n }),
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      kind: fc.constant('withdraw' as const),
      account: fc.constantFrom(...ACCOUNTS),
      amount: fc.bigInt({ min: 1n, max: 3_000n * USDC }),
      key: fc.integer({ min: 0, max: 10 }),
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      kind: fc.constant('settle' as const),
      account: fc.constantFrom(...ACCOUNTS),
      key: fc.integer({ min: 0, max: 10 }),
      executed: fc.boolean(),
    }),
  },
);
// Occasional large gaps (±5–40 %), as at a Monday open or a jump.
const gapStep: fc.Arbitrary<Step> = fc.record({
  kind: fc.constant('move' as const),
  bp: fc.oneof(fc.integer({ min: -4000, max: -500 }), fc.integer({ min: 500, max: 4000 })),
  window: fc.constantFrom<WindowId>('A', 'D'),
  gap: fc.constant(true),
});

/** Turns abstract steps into engine inputs (prices follow a bounded random walk). */
function toInputs(steps: Step[]): EngineInput[] {
  const inputs: EngineInput[] = [
    {
      type: 'GenesisCapital',
      house: usdc(50_000_000n * USDC),
      insurance: usdc(5_000_000n * USDC),
      source: 'dev',
    },
    listASML,
  ];
  let px = 70_000n;
  let n = 0;
  const md = (window: WindowId, sigmaBp: bigint): EngineInput => {
    const half = (px * sigmaBp * 25n) / 100_000n + 1n; // ±2.5σ
    return {
      type: 'MarketData',
      market: 'ASML-PERP',
      window,
      fv: ticks(px),
      bandLo: ticks(px - half),
      bandHi: ticks(px + half),
      index: ticks(px),
      mark: ticks(px),
      markClamped: false,
      sigmaPpm: sigmaBp * 100n,
      breaker: 'none',
    };
  };
  inputs.push(md('A', 10n));
  for (const s of steps) {
    n += 1;
    switch (s.kind) {
      case 'move':
        px = px + (px * BigInt(s.bp)) / 10_000n;
        if (px < 1_000n) px = 1_000n;
        inputs.push(md(s.window, s.gap ? 200n : 10n));
        break;
      case 'deposit':
        inputs.push({ type: 'DevDeposit', account: s.account, amount: usdc(s.amount) });
        break;
      case 'order':
        inputs.push({
          type: 'PlaceOrder',
          requestId: `r${n}`,
          idempotencyKey: `k${s.key}`,
          account: s.account,
          market: 'ASML-PERP',
          side: s.buy ? 'buy' : 'sell',
          qty: lots(s.qty),
          reduceOnly: s.reduceOnly,
        });
        break;
      case 'close':
        inputs.push({
          type: 'ClosePosition',
          requestId: `c${n}`,
          idempotencyKey: `c${n}`,
          account: s.account,
          market: 'ASML-PERP',
        });
        break;
      case 'resting': {
        const at = ticks(px + (px * BigInt(s.bp)) / 10_000n);
        inputs.push({
          type: 'PlaceOrder',
          requestId: `r${n}`,
          idempotencyKey: `k${s.key}`,
          account: s.account,
          market: 'ASML-PERP',
          side: s.buy ? 'buy' : 'sell',
          qty: lots(s.qty),
          reduceOnly: s.reduceOnly,
          ...(s.type === 'limit' || s.type === 'stop-limit' ? { limitPrice: at } : {}),
          ...(s.type === 'limit'
            ? {}
            : { stop: { price: at, kind: s.type === 'take-profit' ? 'take-profit' : 'stop' } }),
          ...(s.oco === null ? {} : { ocoGroup: `g${s.oco}` }),
          ...(s.tif === 'gtc' ? {} : { timeInForce: s.tif }),
          ...(s.postOnly ? { postOnly: true } : {}),
        });
        break;
      }
      case 'cancel':
        inputs.push({
          type: 'CancelOrder',
          requestId: `x${n}`,
          account: s.account,
          orderId: `k${s.key}`,
        });
        break;
      case 'dividend':
        inputs.push({
          type: 'DividendExDate',
          market: 'ASML-PERP',
          exDate: new Date(Date.UTC(2027, 0, 1 + n)).toISOString().slice(0, 10),
          grossPerShare: ticks(s.gross),
          withholdingBps: s.withholdingBps,
        });
        break;
      case 'withdraw':
        inputs.push({
          type: 'RequestWithdrawal',
          requestId: `w${s.key}`,
          account: s.account,
          amount: usdc(s.amount),
        });
        break;
      case 'settle':
        inputs.push({
          type: s.executed ? 'WithdrawalExecuted' : 'WithdrawalExpired',
          withdrawalId: `${s.account}:w${s.key}`,
        });
        break;
      case 'tick':
        inputs.push({ type: 'ClockTick' });
        break;
    }
  }
  return inputs;
}

function runLive(inputs: EngineInput[]) {
  const state = createState();
  const events: EngineEvent[] = [];
  const counts = { fills: 0, liquidations: 0, rejections: 0, resting: 0, oco: 0, fundings: 0 };
  inputs.forEach((input, i) => {
    const e: EngineEvent = {
      seq: BigInt(i + 1),
      // 37 s apart: each run spans several funding hours.
      ts: 1_793_000_000_000n + BigInt(i) * 37_000n,
      v: 1,
      input,
    };
    events.push(e);
    for (const o of apply(state, e)) {
      if (o.type === 'OrderFilled' && !o.duplicate) counts.fills += 1;
      if (o.type === 'Liquidated') counts.liquidations += 1;
      if (o.type === 'OrderRejected') counts.rejections += 1;
      // Fills on market data come from resting limit / stop orders.
      if (o.type === 'OrderFilled' && input.type === 'MarketData') counts.resting += 1;
      if (o.type === 'OrderCancelled' && o.reason === 'oco') counts.oco += 1;
      if (o.type === 'FundingSettled') counts.fundings += 1;
    }
  });
  return { state, events, counts };
}

describe('engine invariants under random inputs (fast-check, 15 000+ steps)', () => {
  it('holds invariants 1, 2, 4, 5, 7, 8, 9 after every event, and replay(log) == live state', () => {
    let totals = { steps: 0, fills: 0, liquidations: 0, resting: 0, oco: 0, fundings: 0 };
    fc.assert(
      fc.property(
        fc.array(fc.oneof({ weight: 30, arbitrary: step }, { weight: 1, arbitrary: gapStep }), {
          minLength: 300,
          maxLength: 800,
        }),
        (steps) => {
          const { state, events, counts } = runLive(toInputs(steps)); // throws on any invariant violation
          const decoded = events.map((e) => decodeEvent(encodeEvent(e)));
          expect(stateDigest(replay(decoded))).toBe(stateDigest(state));
          totals = {
            steps: totals.steps + events.length,
            fills: totals.fills + counts.fills,
            liquidations: totals.liquidations + counts.liquidations,
            resting: totals.resting + counts.resting,
            oco: totals.oco + counts.oco,
            fundings: totals.fundings + counts.fundings,
          };
        },
      ),
      { numRuns: 50 },
    );
    // The generator must actually exercise trading, resting/stop orders, OCO, funding and liquidation.
    // Floors sit well below typical runs (≈ 1 000 fills, ≈ 95 resting fills since withdrawals
    // and IOC/FOK joined the mix) so they catch a dead generator, not seed noise.
    expect(totals.steps).toBeGreaterThan(15_000);
    expect(totals.fills).toBeGreaterThan(600);
    expect(totals.liquidations).toBeGreaterThan(0);
    expect(totals.resting).toBeGreaterThan(50);
    expect(totals.oco).toBeGreaterThan(0);
    expect(totals.fundings).toBeGreaterThan(100);
  }, 120_000);

  it('restore(snapshot at any seq) + replay of the rest == the live state (M4-19)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.oneof({ weight: 30, arbitrary: step }, { weight: 1, arbitrary: gapStep }), {
          minLength: 100,
          maxLength: 400,
        }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (steps, at) => {
          const { state, events } = runLive(toInputs(steps));
          const cut = Math.floor(at * events.length);
          const snap = encodeState(replay(events.slice(0, cut)));
          // Stable bytes, and decoding loses nothing.
          expect(encodeState(decodeState(snap)).equals(snap)).toBe(true);
          const restored = replay(events.slice(cut), decodeState(snap));
          expect(stateDigest(restored)).toBe(stateDigest(state));
          expect(encodeState(restored).equals(encodeState(state))).toBe(true);
        },
      ),
      { numRuns: 40 },
    );
  }, 120_000);
});
