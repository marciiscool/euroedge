import { describe, expect, it } from 'vitest';
import { ticks } from '@euroedge/fixed';
import type { EngineEvent, EngineInput } from '../src/core/events.ts';
import { chainHash, encodeEvent, EVENT_VERSIONS, GENESIS_HASH } from '../src/log/codec.ts';
import { stateDigest } from '../src/log/digest.ts';
import { replay } from '../src/log/replay.ts';
import { restoreFromLog, SnapshotMismatch, verifyLog, type Snapshot } from '../src/log/restore.ts';
import { encodeState } from '../src/log/state-codec.ts';
import type { StoredRecord } from '../src/log/store.ts';
import { data, Harness, order } from './fixtures.ts';

/** A trading session as hash-chained records, plus the events. */
function session() {
  const h = Harness.booted();
  h.run(
    order('alice', 'buy', 300n),
    data(70_400n),
    {
      ...(order('alice', 'sell', 100n, { reduceOnly: true }) as Extract<
        EngineInput,
        { type: 'PlaceOrder' }
      >),
      stop: { price: ticks(69_500n), kind: 'stop' },
    },
    data(69_400n),
    order('alice', 'buy', 50n),
    data(69_900n),
  );
  const events: EngineEvent[] = h.log.map((input, i) => ({
    seq: BigInt(i + 1),
    ts: 1_793_000_000_000n + BigInt(i) * 1000n,
    v: EVENT_VERSIONS[input.type],
    input,
  }));
  let prev = GENESIS_HASH;
  const records: StoredRecord[] = events.map((e) => {
    const body = encodeEvent(e);
    prev = chainHash(prev, body);
    return { seq: e.seq, ts: e.ts, body, hash: prev };
  });
  return { events, records, final: stateDigest(replay(events)) };
}

const snapshotAt = (events: EngineEvent[], records: StoredRecord[], seq: number): Snapshot => {
  const s = replay(events.slice(0, seq));
  return {
    seq: BigInt(seq),
    chainHash: records[seq - 1]?.hash ?? '',
    digest: stateDigest(s),
    body: encodeState(s),
  };
};

describe('snapshot restore and log verifier (M4-19)', () => {
  it('restores from a snapshot and replays the rest to the same state', async () => {
    const { events, records, final } = session();
    for (const seq of [1, 4, 7, events.length]) {
      const r = await restoreFromLog(records, snapshotAt(events, records, seq));
      expect(r.from).toBe(BigInt(seq));
      expect(stateDigest(r.state)).toBe(final);
      expect(r.head).toEqual({ seq: BigInt(events.length), hash: records.at(-1)?.hash });
    }
    expect(stateDigest((await restoreFromLog(records)).state)).toBe(final);
  });

  it('rejects a snapshot whose body, digest or chain hash does not match', async () => {
    const { events, records } = session();
    const good = snapshotAt(events, records, 5);
    const otherBody = snapshotAt(events, records, 6).body;
    await expect(restoreFromLog(records, { ...good, body: otherBody })).rejects.toThrow(
      SnapshotMismatch,
    );
    await expect(restoreFromLog(records, { ...good, chainHash: GENESIS_HASH })).rejects.toThrow(
      /chain hash/,
    );
    await expect(restoreFromLog(records.slice(0, 3), good)).rejects.toThrow(/ahead of the log/);
  });

  it('still verifies the whole chain when restoring from a snapshot', async () => {
    const { events, records } = session();
    const tampered = records.map((r, i) =>
      i === 1 ? { ...r, body: Buffer.from(r.body.toString().replace('"A"', '"B"')) } : r,
    );
    await expect(restoreFromLog(tampered, snapshotAt(events, records, 6))).rejects.toThrow(
      /hash chain broken at seq 2/,
    );
  });

  it('the verifier replays from genesis and checks every snapshot', async () => {
    const { events, records, final } = session();
    const snaps = new Map([3, 6, 9].map((n) => [BigInt(n), snapshotAt(events, records, n)]));
    const ok = await verifyLog(records, snaps);
    expect(ok).toMatchObject({ events: BigInt(events.length), digest: final, snapshotsChecked: 3 });
    expect(ok.failures).toEqual([]);

    const bad = new Map(snaps);
    const s6 = snaps.get(6n);
    if (s6 !== undefined) bad.set(6n, { ...s6, digest: 'x'.repeat(64) });
    bad.set(99n, { ...snapshotAt(events, records, 9), seq: 99n });
    const r = await verifyLog(records, bad);
    expect(r.failures).toEqual([
      'snapshot 6: digest ≠ replay',
      `snapshot 99 is ahead of the log (${events.length})`,
    ]);
  });
});
