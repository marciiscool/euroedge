import { createHash } from 'node:crypto';
import { Ledger } from '@euroedge/ledger';
import type { EngineState } from '../core/state.ts';
import { canonicalBytes } from './canonical.ts';

/**
 * Lossless engine-state snapshots (M4-19). Canonical JSON with tagged values, so bigints stay
 * bigints and Maps keep their insertion order, which decides matching and iteration order in
 * the core: restore(snapshot at n) + replay(n+1…) must equal replay(1…) bit for bit.
 */

export const STATE_FORMAT = 1;

type Plain = null | boolean | number | string | Plain[] | { [k: string]: Plain };

function toPlain(v: unknown): Plain {
  if (typeof v === 'bigint') return { $n: v.toString() };
  if (v === null || typeof v === 'boolean' || typeof v === 'string') return v;
  if (typeof v === 'number') return v;
  if (Array.isArray(v)) return v.map(toPlain);
  if (v instanceof Map) return { $map: [...v].map(([k, x]) => [toPlain(k), toPlain(x)]) };
  if (v instanceof Ledger) return { $ledger: v.entries().map(([k, b]) => [k, toPlain(b)]) };
  if (typeof v === 'object' && v !== null && Object.getPrototypeOf(v) === Object.prototype) {
    const out: Record<string, Plain> = {};
    for (const [k, x] of Object.entries(v)) {
      // An absent optional field (e.g. `data` of a market listed but not yet priced) is
      // omitted, and decodes back as absent.
      if (x !== undefined) out[k] = toPlain(x);
    }
    return out;
  }
  throw new TypeError(`cannot snapshot ${typeof v} value in engine state`);
}

function fromPlain(p: Plain): unknown {
  if (p === null || typeof p !== 'object') return p;
  if (Array.isArray(p)) return p.map(fromPlain);
  const keys = Object.keys(p);
  if (keys.length === 1) {
    const [k] = keys;
    const x = p[k as string] as Plain;
    if (k === '$n' && typeof x === 'string') return BigInt(x);
    if (k === '$map' && Array.isArray(x))
      return new Map(
        (x as Plain[][]).map(([a, b]) => [fromPlain(a ?? null), fromPlain(b ?? null)]),
      );
    if (k === '$ledger' && Array.isArray(x))
      return Ledger.fromEntries(
        (x as [string, Plain][]).map(([a, b]) => [a, fromPlain(b) as bigint] as const),
      );
  }
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(p)) out[k] = fromPlain(x);
  return out;
}

/** Snapshot bytes of the full engine state. */
export const encodeState = (state: EngineState): Buffer =>
  canonicalBytes({ format: STATE_FORMAT, state: toPlain(state) });

export function decodeState(bytes: Buffer | string): EngineState {
  const raw = JSON.parse(typeof bytes === 'string' ? bytes : bytes.toString('utf8')) as {
    format?: unknown;
    state?: Plain;
  };
  if (raw.format !== STATE_FORMAT || raw.state === undefined)
    throw new Error(`unsupported state snapshot format ${String(raw.format)}`);
  return fromPlain(raw.state) as EngineState;
}

/** sha256 of the snapshot bytes. */
export const snapshotHash = (bytes: Buffer): string =>
  createHash('sha256').update(bytes).digest('hex');
