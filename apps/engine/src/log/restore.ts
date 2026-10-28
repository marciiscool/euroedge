import { apply } from '../core/apply.ts';
import { createState, type EngineState } from '../core/state.ts';
import { chainHash, decodeEvent, GENESIS_HASH } from './codec.ts';
import { stateDigest } from './digest.ts';
import { decodeState, encodeState } from './state-codec.ts';
import type { StoredRecord } from './store.ts';

/** A stored state snapshot (M4-19). */
export interface Snapshot {
  readonly seq: bigint;
  /** Log hash of event `seq`. */
  readonly chainHash: string;
  readonly digest: string;
  readonly body: Buffer;
}

export class SnapshotMismatch extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotMismatch';
  }
}

export interface Restored {
  readonly state: EngineState;
  readonly head: { readonly seq: bigint; readonly hash: string };
  /** Seq of the snapshot the state was restored from; 0 = replayed from genesis. */
  readonly from: bigint;
}

/**
 * Rebuilds state from the log, verifying the whole hash chain from genesis. With a snapshot,
 * events up to its seq are hashed but not applied; the snapshot is used only if its digest
 * matches its body and its chain hash matches the log (else SnapshotMismatch: retry without).
 */
export async function restoreFromLog(
  records: AsyncIterable<StoredRecord> | Iterable<StoredRecord>,
  snapshot?: Snapshot,
): Promise<Restored> {
  let state = createState();
  let pending: EngineState | undefined;
  if (snapshot !== undefined) {
    // An unreadable or older-shape snapshot is a mismatch too: the caller replays from genesis.
    let digest: string;
    try {
      pending = decodeState(snapshot.body);
      digest = stateDigest(pending);
    } catch (err) {
      throw new SnapshotMismatch(
        `snapshot ${snapshot.seq}: unreadable (${err instanceof Error ? err.message : 'error'})`,
      );
    }
    if (digest !== snapshot.digest)
      throw new SnapshotMismatch(`snapshot ${snapshot.seq}: digest does not match its body`);
  }
  let prev = GENESIS_HASH;
  let seq = 0n;
  for await (const rec of records) {
    prev = chainHash(prev, rec.body);
    if (prev !== rec.hash) throw new Error(`hash chain broken at seq ${rec.seq}`);
    seq = rec.seq;
    if (pending !== undefined && snapshot !== undefined && rec.seq <= snapshot.seq) {
      if (rec.seq === snapshot.seq) {
        if (prev !== snapshot.chainHash)
          throw new SnapshotMismatch(`snapshot ${snapshot.seq}: chain hash differs from the log`);
        state = pending;
      }
      continue;
    }
    apply(state, decodeEvent(rec.body));
  }
  if (snapshot !== undefined && seq < snapshot.seq)
    throw new SnapshotMismatch(`snapshot ${snapshot.seq} is ahead of the log (${seq})`);
  return { state, head: { seq, hash: prev }, from: snapshot?.seq ?? 0n };
}

export interface VerifyReport {
  readonly events: bigint;
  readonly head: string;
  readonly digest: string;
  readonly snapshotsChecked: number;
  readonly failures: readonly string[];
}

/**
 * Verifier (M4-19): replays the whole log from genesis (invariants asserted on every event),
 * checks the hash chain, and compares every snapshot with the replayed state at its seq.
 */
export async function verifyLog(
  records: AsyncIterable<StoredRecord> | Iterable<StoredRecord>,
  snapshots: ReadonlyMap<bigint, Snapshot>,
): Promise<VerifyReport> {
  const state = createState();
  const failures: string[] = [];
  let prev = GENESIS_HASH;
  let events = 0n;
  let checked = 0;
  for await (const rec of records) {
    if (rec.seq !== events + 1n) {
      failures.push(`sequence gap: expected ${events + 1n}, got ${rec.seq}`);
      break;
    }
    prev = chainHash(prev, rec.body);
    if (prev !== rec.hash) {
      failures.push(`hash chain broken at seq ${rec.seq}`);
      break;
    }
    apply(state, decodeEvent(rec.body));
    events = rec.seq;
    const s = snapshots.get(rec.seq);
    if (s === undefined) continue;
    checked += 1;
    if (s.chainHash !== prev) failures.push(`snapshot ${s.seq}: chain hash differs from the log`);
    if (s.digest !== stateDigest(state)) failures.push(`snapshot ${s.seq}: digest ≠ replay`);
    if (!encodeState(state).equals(s.body)) failures.push(`snapshot ${s.seq}: body ≠ replay`);
  }
  for (const seq of snapshots.keys())
    if (seq > events) failures.push(`snapshot ${seq} is ahead of the log (${events})`);
  return { events, head: prev, digest: stateDigest(state), snapshotsChecked: checked, failures };
}
