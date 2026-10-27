import { z } from 'zod';

/** Valkey names shared by engine, fv-service and api. */
export const STREAMS = {
  /** Engine input commands (canonical JSON, bigints as strings). */
  engineInput: 'engine:input',
} as const;

export const CHANNELS = {
  results: 'engine:results',
  account: (id: string) => `account:${id}`,
  market: (id: string) => `market:${id}`,
  fv: (id: string) => `fv:${id}`,
  ticks: 'ticks',
} as const;

export const KEYS = {
  account: (id: string) => `state:account:${id}`,
  market: (id: string) => `state:market:${id}`,
  fv: (id: string) => `state:fv:${id}`,
} as const;

const dec = z.string().regex(/^-?\d+(\.\d+)?$/);
const int = z.string().regex(/^-?\d+$/);

/** Market snapshot published by the engine after every market change (decimal strings). */
export const marketSnapshotSchema = z.object({
  market: z.string(),
  seq: int,
  ts: z.number().int(),
  window: z.enum(['A', 'B', 'C', 'D']),
  fv: dec,
  bandLo: dec,
  bandHi: dec,
  index: dec,
  mark: dec,
  bid: dec,
  ask: dec,
  sigmaBp: z.number(),
  maxLeverage: z.number().int(),
  takerFeeBps: z.number().int(),
  tickSize: dec,
  lotSize: dec,
  minNotional: dec,
});
export type MarketSnapshot = z.infer<typeof marketSnapshotSchema>;

export const positionViewSchema = z.object({
  market: z.string(),
  /** Signed size in contracts (decimal). */
  size: dec,
  entry: dec.nullable(),
  mark: dec.nullable(),
  upnl: dec,
  liquidationPrice: dec.nullable(),
});
export type PositionView = z.infer<typeof positionViewSchema>;

/** Account snapshot: USDC amounts as decimal strings. */
export const accountSnapshotSchema = z.object({
  account: z.string(),
  seq: int,
  cash: dec,
  equity: dec,
  maintenance: dec,
  positions: z.array(positionViewSchema),
});
export type AccountSnapshot = z.infer<typeof accountSnapshotSchema>;

export const rejectReasonSchema = z.enum([
  'not-genesis',
  'unknown-market',
  'no-market-data',
  'unknown-account',
  'reduce-only',
  'reduce-only-window',
  'price-limit',
  'min-notional',
  'insufficient-margin',
  'no-position',
]);

/** Order result published on CHANNELS.results (one message per request). */
export const orderResultSchema = z.discriminatedUnion('status', [
  z.object({
    requestId: z.string(),
    seq: int,
    status: z.literal('filled'),
    duplicate: z.boolean(),
    fill: z.object({
      market: z.string(),
      side: z.enum(['buy', 'sell']),
      size: dec,
      price: dec,
      fee: dec,
      realized: dec,
    }),
  }),
  z.object({
    requestId: z.string(),
    seq: int,
    status: z.literal('rejected'),
    duplicate: z.boolean(),
    reason: rejectReasonSchema,
  }),
]);
export type OrderResult = z.infer<typeof orderResultSchema>;

/** Producers enqueue engine inputs as JSON with bigints as decimal strings. */
export const encodeEngineCommand = (input: unknown): string =>
  JSON.stringify(input, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v));

export const ENGINE_STREAM_MAXLEN = 100_000;

/** FV display snapshot published by fv-service each second (brief §11.2 price provenance). */
export const fvSnapshotSchema = z.object({
  market: z.string(),
  ts: z.number().int(),
  window: z.enum(['A', 'B', 'C', 'D']),
  fv: dec,
  bandLo: dec,
  bandHi: dec,
  index: dec,
  mark: dec,
  sigmaBp: z.number(),
  confidence: z.enum(['high', 'medium', 'low', 'none']),
  anchor: z.object({ price: dec, ts: z.number().int() }),
  sources: z.array(
    z.object({
      kind: z.enum(['tradegate', 'adr']),
      weight: z.number(),
      ageMs: z.number().int(),
      implied: dec,
    }),
  ),
  nextWindowChange: z
    .object({ at: z.number().int(), window: z.enum(['A', 'B', 'C', 'D']) })
    .nullable(),
});
export type FvDisplaySnapshot = z.infer<typeof fvSnapshotSchema>;
