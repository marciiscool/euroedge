import { SimWorld } from '@euroedge/data-adapters';
import { instrumentKey, type MarketConfig, type Tick } from '@euroedge/shared';

/**
 * Fast-forwards a seeded world from its epoch to `now` without keeping history, and returns
 * the latest state per instrument (last close plus last quote/trade) so consumers have
 * anchors immediately. Restarts within the same epoch reproduce the same prices.
 */
export function fastForward(
  seed: number,
  epoch: number,
  now: number,
  markets: readonly MarketConfig[],
) {
  const world = new SimWorld({ seed, startTs: epoch, markets });
  const latest = new Map<string, Tick>();
  const step = 3_600_000;
  const target = Math.floor(now / 1000) * 1000;
  for (let t = epoch; t < target; t = Math.min(t + step, target)) {
    for (const tick of world.advanceTo(Math.min(t + step, target))) {
      const cls = tick.kind === 'close' ? 'close' : 'live';
      latest.set(`${instrumentKey(tick.instrument)}|${cls}`, tick);
    }
  }
  const snapshot = [...latest.values()].sort((a, b) => a.ts - b.ts);
  return { world, snapshot };
}
