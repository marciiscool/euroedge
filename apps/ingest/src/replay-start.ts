import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTickFile, ReplayProvider } from '@euroedge/data-adapters';
import type { Tick } from '@euroedge/shared';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

/**
 * DATA_TIER=replay: recorded ticks on a virtual clock with their original timestamps.
 * Downstream services still evaluate on the wall clock; a shared virtual clock for the whole
 * stack is part of the M3 backtest work, so full-stack replays use the backtest CLI.
 */
export async function replaySource(file: string, speed: number) {
  const ticks = await loadTickFile(isAbsolute(file) ? file : join(repoRoot, file));
  const provider = new ReplayProvider({ ticks, speed });
  const pending: Tick[] = [];
  const keys = [
    ...new Map(
      ticks.map((t) => [`${t.instrument.venue}:${t.instrument.symbol}`, t.instrument]),
    ).values(),
  ];
  provider.subscribe(keys, (t) => pending.push(t));
  return {
    count: ticks.length,
    advance: (): Tick[] => {
      provider.poll();
      return pending.splice(0);
    },
  };
}
