import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { EngineEvent, EngineInput } from '../core/events.ts';
import { canonicalBytes } from './canonical.ts';

/** Current schema version per input type. Bump + add an upcaster when a payload changes. */
export const EVENT_VERSIONS: Readonly<Record<EngineInput['type'], number>> = {
  ClockTick: 1,
  GenesisCapital: 1,
  MarketListed: 2,
  MarketData: 2,
  DevDeposit: 1,
  PlaceOrder: 2,
  CancelOrder: 1,
  ClosePosition: 1,
};

export const GENESIS_HASH = createHash('sha256').update('euroedge-genesis-v1').digest('hex');

const nonNeg = z.string().regex(/^\d+$/).transform(BigInt);
const pos = z
  .string()
  .regex(/^[1-9]\d*$/)
  .transform(BigInt);
const id = z.string().min(1).max(128);
const window = z.enum(['A', 'B', 'C', 'D']);
const windowRisk = z.object({
  maxLeverage: nonNeg,
  takerFeeBps: nonNeg,
  makerFeeBps: nonNeg.default(0n),
  houseHalfSpreadBps: nonNeg,
  priceLimitBps: nonNeg,
  // v1 logs predate funding: no cap → interest only, which v1 logs also carry as 0.
  fundingCapPpmPerHour: nonNeg.nullable().default(null),
  fundingOiCap: nonNeg.default(0n),
});

/** Decoders: canonical JSON (bigints as strings) → typed inputs. */
export const inputSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ClockTick') }),
  z.object({
    type: z.literal('GenesisCapital'),
    house: nonNeg,
    insurance: nonNeg,
    source: z.enum(['dev', 'chain']),
  }),
  z.object({
    type: z.literal('MarketListed'),
    market: id,
    kind: z.enum(['stock', 'basket']),
    tickSize: z.string(),
    lotSize: z.string(),
    minNotional: nonNeg,
    maintenanceMarginBps: pos,
    liquidationPenaltyBps: nonNeg,
    fundingInterestBpsPerYear: nonNeg.default(0n),
    windows: z.object({ A: windowRisk, B: windowRisk, C: windowRisk, D: windowRisk }),
  }),
  z.object({
    type: z.literal('MarketData'),
    market: id,
    window,
    fv: pos,
    bandLo: pos,
    bandHi: pos,
    index: pos,
    mark: pos,
    markClamped: z.boolean(),
    sigmaPpm: nonNeg,
    breaker: z.enum(['none', 'no-opens', 'degraded', 'reduce-only']).default('none'),
  }),
  z.object({ type: z.literal('DevDeposit'), account: id, amount: pos }),
  z.object({
    type: z.literal('PlaceOrder'),
    requestId: id,
    idempotencyKey: id,
    account: id,
    market: id,
    side: z.enum(['buy', 'sell']),
    qty: pos,
    reduceOnly: z.boolean(),
    limitPrice: pos.optional(),
  }),
  z.object({ type: z.literal('CancelOrder'), requestId: id, account: id, orderId: id }),
  z.object({
    type: z.literal('ClosePosition'),
    requestId: id,
    idempotencyKey: id,
    account: id,
    market: id,
  }),
]);

const envelopeSchema = z.object({
  seq: nonNeg,
  ts: nonNeg,
  v: z.number().int().positive(),
  input: z.unknown(),
});

/** Canonical body bytes of an event (what is stored and hashed). */
export const encodeEvent = (e: EngineEvent): Buffer =>
  canonicalBytes({ seq: e.seq, ts: e.ts, v: e.v, input: e.input });

export function decodeEvent(bytes: Buffer | string): EngineEvent {
  const raw: unknown = JSON.parse(typeof bytes === 'string' ? bytes : bytes.toString('utf8'));
  const env = envelopeSchema.parse(raw);
  const input = inputSchema.parse(upcast(env.v, env.input)) as EngineInput;
  if (env.v > EVENT_VERSIONS[input.type])
    throw new Error(`unknown future version v${env.v} of ${input.type}`);
  return { seq: env.seq, ts: env.ts, v: env.v, input };
}

/** Upcasters for old payload versions (none yet: every type is at v1). */
function upcast(_v: number, input: unknown): unknown {
  return input;
}

/** hash_n = sha256(hash_{n−1} ‖ body_n), hex. */
export const chainHash = (prevHashHex: string, body: Buffer): string =>
  createHash('sha256').update(Buffer.from(prevHashHex, 'hex')).update(body).digest('hex');

export interface ChainedRecord {
  readonly seq: bigint;
  readonly body: Buffer;
  readonly hash: string;
}

/** Verifies seq continuity and the hash chain from genesis (Invariant 6). */
export function verifyChain(
  records: Iterable<ChainedRecord>,
  startHash = GENESIS_HASH,
  startSeq = 1n,
): string {
  let prev = startHash;
  let expectSeq = startSeq;
  for (const r of records) {
    if (r.seq !== expectSeq) throw new Error(`sequence gap: expected ${expectSeq}, got ${r.seq}`);
    const h = chainHash(prev, r.body);
    if (h !== r.hash) throw new Error(`hash mismatch at seq ${r.seq}`);
    prev = h;
    expectSeq += 1n;
  }
  return prev;
}
