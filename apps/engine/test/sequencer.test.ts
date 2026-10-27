import { describe, expect, it } from 'vitest';
import { usdc } from '@euroedge/fixed';
import { loadMarkets, loadWindows } from '@euroedge/shared/config';
import { bootstrapInputs, GENESIS } from '../src/bootstrap.ts';
import type { EngineEvent } from '../src/core/events.ts';
import { createState } from '../src/core/state.ts';
import { canonicalJson } from '../src/log/canonical.ts';
import { FatalEngineError, Sequencer, type AppendLog } from '../src/sequencer.ts';
import { data, listASML, USDC } from './fixtures.ts';

class MemoryLog implements AppendLog {
  readonly events: EngineEvent[] = [];
  cursor: string | undefined;
  fail = false;
  append(events: readonly EngineEvent[], cursor?: string): Promise<void> {
    if (this.fail) return Promise.reject(new Error('db down'));
    this.events.push(...events);
    if (cursor !== undefined) this.cursor = cursor;
    return Promise.resolve();
  }
}

const msg = (id: string, input: unknown) => ({ id, payload: canonicalJson(input) });

describe('Sequencer', () => {
  it('stamps seq and a non-decreasing ts, appends with the cursor, skips invalid inputs', async () => {
    const log = new MemoryLog();
    let now = 2_000;
    const seq = new Sequencer(createState(), log, () => now);
    await seq.processInputs([
      {
        type: 'GenesisCapital',
        house: usdc(GENESIS.house),
        insurance: usdc(GENESIS.insurance),
        source: 'dev',
      },
      listASML,
    ]);
    now = 1_000; // wall clock steps back
    const r = await seq.processMessages([
      msg('5-0', data(70_000n)),
      { id: '5-1', payload: '{"type":"DevDeposit","account":"a","amount":"-1"}' },
      msg('5-2', { type: 'DevDeposit', account: 'a', amount: 1_000n * USDC }),
    ]);
    expect(r.skipped.map((s) => s.id)).toEqual(['5-1']);
    expect(log.events.map((e) => e.seq)).toEqual([1n, 2n, 3n, 4n]);
    expect(log.events.map((e) => e.ts)).toEqual([2_000n, 2_000n, 2_000n, 2_000n]);
    expect(log.cursor).toBe('5-2');
    expect(r.outputs.some((o) => o.output.type === 'AccountChanged')).toBe(true);
  });

  it('fail-stops when the log cannot be written, and refuses further input', async () => {
    const log = new MemoryLog();
    const seq = new Sequencer(createState(), log, () => 1);
    log.fail = true;
    await expect(seq.processInputs([{ type: 'ClockTick' }])).rejects.toThrow(FatalEngineError);
    expect(seq.healthy).toBe(false);
    log.fail = false;
    await expect(seq.processInputs([{ type: 'ClockTick' }])).rejects.toThrow(/fail-stopped/);
    expect(log.events).toEqual([]);
  });

  it('fail-stops on an invariant violation without appending the batch', async () => {
    const log = new MemoryLog();
    const state = createState();
    const seq = new Sequencer(state, log, () => 1);
    state.netDeposits = 1n; // corrupt
    await expect(seq.processInputs([{ type: 'ClockTick' }])).rejects.toThrow(FatalEngineError);
    expect(log.events).toEqual([]);
  });
});

describe('bootstrapInputs', () => {
  it('adds genesis once (sim) and lists markets only when config differs from the log', async () => {
    const markets = await loadMarkets();
    const windows = await loadWindows();
    const log = new MemoryLog();
    const state = createState();
    const seq = new Sequencer(state, log, () => 1);
    const first = bootstrapInputs(state, markets, windows, 'sim');
    expect(first.map((i) => i.type)).toEqual(['GenesisCapital', 'MarketListed']);
    await seq.processInputs(first);
    expect(bootstrapInputs(state, markets, windows, 'sim')).toEqual([]);
    const changed = { ...windows, maintenanceMarginBps: { stock: 1200, basket: 500 } };
    expect(bootstrapInputs(state, markets, changed, 'sim').map((i) => i.type)).toEqual([
      'MarketListed',
    ]);
    expect(bootstrapInputs(createState(), markets, windows, 'live-min').map((i) => i.type)).toEqual(
      ['MarketListed'],
    );
  });
});
