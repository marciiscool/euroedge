import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import { lots, ticks, usdc } from '@euroedge/fixed';
import { Rng, SimWorld } from '@euroedge/data-adapters';
import { MarketFvPipeline } from '@euroedge/fv-core';
import { loadFvParams, loadMarkets, loadWindows } from '@euroedge/shared/config';
import { apply } from '../src/core/apply.ts';
import type { EngineEvent, EngineInput, WindowId } from '../src/core/events.ts';
import { createState } from '../src/core/state.ts';
import {
  chainHash,
  decodeEvent,
  encodeEvent,
  GENESIS_HASH,
  verifyChain,
} from '../src/log/codec.ts';
import { stateDigest } from '../src/log/digest.ts';
import { replay } from '../src/log/replay.ts';
import { marketListedInput } from '../src/market-config.ts';

const cet = (iso: string) => DateTime.fromISO(iso, { zone: 'Europe/Berlin' }).toMillis();
const USDC = 1_000_000n;
const BOTS = 12;

/**
 * One simulated ASML trading day through the real components, in-process:
 * SimWorld → MarketFvPipeline (fv-core + calendar) → engine core, plus seeded traders.
 * Thu 22:00 → Sat 02:00 CET covers windows C → B → A → B → D.
 */
async function simulateDay(seed: number) {
  const [asml] = await loadMarkets();
  if (asml === undefined) throw new Error('no ASML config');
  const fvParams = await loadFvParams();
  const windowsFile = await loadWindows();
  const start = cet('2026-10-29T22:00');
  const end = cet('2026-10-31T02:00');
  const world = new SimWorld({ seed, startTs: start, markets: [asml] });
  const pipeline = new MarketFvPipeline(asml, fvParams, windowsFile.markStepCapBpsPerSecond);
  const rng = new Rng(seed + 1);
  const state = createState();
  const events: EngineEvent[] = [];
  const stats = { fills: 0, rejections: 0, liquidations: 0, clamps: 0, marketData: 0 };
  const windows: WindowId[] = [];

  const push = (ts: number, input: EngineInput) => {
    const e: EngineEvent = { seq: BigInt(events.length + 1), ts: BigInt(ts), v: 1, input };
    events.push(e);
    for (const o of apply(state, e)) {
      if (o.type === 'OrderFilled') stats.fills += 1;
      if (o.type === 'OrderRejected') stats.rejections += 1;
      if (o.type === 'Liquidated') stats.liquidations += 1;
      if (o.type === 'MarkClamped') stats.clamps += 1;
    }
  };

  push(start, {
    type: 'GenesisCapital',
    house: usdc(50_000_000n * USDC),
    insurance: usdc(5_000_000n * USDC),
    source: 'dev',
  });
  push(start, marketListedInput(asml, windowsFile));
  for (let b = 0; b < BOTS; b++)
    push(start, { type: 'DevDeposit', account: `bot${b}`, amount: usdc(10_000n * USDC) });

  let n = 0;
  for (let ts = start; ts <= end; ts += 1000) {
    for (const t of world.advanceTo(ts)) pipeline.onTick(t);
    const out = pipeline.evaluate(ts);
    if (out === undefined) continue;
    const u = out.update;
    if (windows.at(-1) !== u.window) windows.push(u.window);
    push(ts, {
      type: 'MarketData',
      market: asml.id,
      window: u.window,
      fv: ticks(u.fv),
      bandLo: ticks(u.bandLo),
      bandHi: ticks(u.bandHi),
      index: ticks(u.index),
      mark: ticks(u.mark),
      markClamped: u.markClamped,
      sigmaPpm: u.sigmaPpm,
    });
    stats.marketData += 1;
    if (ts % 60_000 === 0) push(ts, { type: 'ClockTick' });
    // Seeded traders: noise orders of all sizes (some beyond the window's leverage cap), closes.
    for (let b = 0; b < BOTS; b++) {
      if (!rng.chance(0.0015)) continue;
      n += 1;
      if (rng.chance(0.25)) {
        push(ts, {
          type: 'ClosePosition',
          requestId: `c${n}`,
          idempotencyKey: `c${n}`,
          account: `bot${b}`,
          market: asml.id,
        });
      } else {
        const qty = BigInt(1 + Math.floor(rng.uniform() * (b < 3 ? 7_000 : 2_500)));
        push(ts, {
          type: 'PlaceOrder',
          requestId: `o${n}`,
          idempotencyKey: `o${n}`,
          account: `bot${b}`,
          market: asml.id,
          side: rng.chance(0.5) ? 'buy' : 'sell',
          qty: lots(qty),
          reduceOnly: false,
        });
      }
    }
  }
  return { state, events, stats, windows };
}

describe('full simulated ASML trading day (M1-21)', () => {
  it('passes all invariants on every event, replays bit-for-bit, and the hash chain verifies', async () => {
    const live = await simulateDay(2026); // apply() asserts invariants 1,2,4,5,7,8,9 after every event

    // All windows, in calendar order: Thu night C → Tradegate B → Amsterdam A → B → weekend D.
    expect(live.windows).toEqual(['C', 'B', 'A', 'B', 'D']);
    expect(live.stats.marketData).toBeGreaterThan(100_000);
    expect(live.stats.fills).toBeGreaterThan(100);

    // Hash-chained log from canonical bytes, verified from genesis (Invariant 6).
    let head = GENESIS_HASH;
    const records = live.events.map((e) => {
      const body = encodeEvent(e);
      head = chainHash(head, body);
      return { seq: e.seq, body, hash: head };
    });
    expect(verifyChain(records)).toBe(head);

    // Replay from the decoded log reproduces the live state exactly.
    const replayed = replay(records.map((r) => decodeEvent(r.body)));
    expect(stateDigest(replayed)).toBe(stateDigest(live.state));

    // The whole pipeline is deterministic: a second live run yields the same chain head.
    const again = await simulateDay(2026);
    let head2 = GENESIS_HASH;
    for (const e of again.events) head2 = chainHash(head2, encodeEvent(e));
    expect(head2).toBe(head);

    console.info(`full day: ${live.events.length} events, stats ${JSON.stringify(live.stats)}`);
  }, 120_000);
});
