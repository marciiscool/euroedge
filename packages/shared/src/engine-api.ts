import { z } from 'zod';

/** Valkey names shared by engine, fv-service and api. */
export const STREAMS = {
  /** Engine input commands (canonical JSON, bigints as strings). */
  engineInput: 'engine:input',
  /** Withdrawal reservations for the engine signer (M5-08): `{ id }` per entry. */
  withdrawals: 'engine:withdrawals',
  /** Hourly balance snapshots for the root poster (M5-12): `{ hour }` per entry. */
  balanceRoots: 'engine:balance-roots',
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
  /** Withdrawal record (M4-18), JSON of `WithdrawalRecord`, written by the engine. */
  withdrawal: (id: string) => `state:withdrawal:${id}`,
  /** Its authorisation (M5-08), JSON of `WithdrawalAuth`, written by the signer. */
  withdrawalAuth: (id: string) => `state:withdrawal-auth:${id}`,
  /** Ids of pending withdrawals (indexer expiry check, M5-10). */
  pendingWithdrawals: 'state:withdrawals:pending',
  /** Ids of one account's withdrawals. */
  accountWithdrawals: (account: string) => `state:withdrawals:account:${account}`,
  /** Hourly balance snapshot (M5-12), JSON of `BalanceSnapshot`. */
  balanceSnapshot: (hour: string) => `state:balances:${hour}`,
  /** Latest snapshot hour, and the posted root per hour (JSON of `PostedRoot`). */
  latestBalanceHour: 'state:balances:latest',
  postedRoot: (hour: string) => `state:balance-root:${hour}`,
} as const;

/** Settled cash of every wallet account at an hour boundary (µUSDC, decimal strings). */
export const balanceSnapshotSchema = z.object({
  hour: z.string().regex(/^\d+$/),
  seq: z.string().regex(/^\d+$/),
  leaves: z.array(z.tuple([z.string().regex(/^0x[0-9a-f]{40}$/), z.string().regex(/^\d+$/)])),
});
export type BalanceSnapshot = z.infer<typeof balanceSnapshotSchema>;

export const postedRootSchema = z.object({
  hour: z.string(),
  root: z.string(),
  txHash: z.string(),
});
export type PostedRoot = z.infer<typeof postedRootSchema>;

/** A withdrawal as the engine reserved it (M4-18), written by the engine on every change. */
export const withdrawalRecordSchema = z.object({
  id: z.string(),
  account: z.string(),
  /** µUSDC. */
  amount: z.string().regex(/^\d+$/),
  nonce: z.string().regex(/^\d+$/),
  deadlineMs: z.string().regex(/^\d+$/),
  status: z.enum(['pending', 'executed', 'expired']),
});
export type WithdrawalRecord = z.infer<typeof withdrawalRecordSchema>;

/**
 * The engine signer's EIP-712 authorisation for a withdrawal (M5-08), written by the signer.
 * `deadlineSec` = ⌊deadlineMs / 1000⌋, so the chain deadline never outlives the engine's.
 */
export const withdrawalAuthSchema = z.object({
  id: z.string(),
  vault: z.string(),
  chainId: z.number().int(),
  deadlineSec: z.string().regex(/^\d+$/),
  signature: z.string(),
});
export type WithdrawalAuth = z.infer<typeof withdrawalAuthSchema>;

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
  /** CB7 (ADR-0013): global reduce-only while house or insurance capital is below its floor. */
  capitalFloor: z.boolean().default(false),
  /** Daily house loss limit hit (M4-14): global reduce-only until the next UTC day. */
  houseLossLimit: z.boolean().default(false),
  /** House inventory limits (M4-14): which user orders adding exposure the house refuses. */
  inventoryLimit: z.enum(['none', 'no-buys', 'no-sells', 'reduce-only']).default('none'),
  /** Executable prices for €1k / €5k / €25k / €100k (ADR-0003 step 8), same function as fills. */
  ladder: z.array(z.object({ notional: dec, bid: dec, ask: dec })).default([]),
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
  /** Resting limit orders. */
  orders: z
    .array(
      z.object({
        orderId: z.string(),
        market: z.string(),
        side: z.enum(['buy', 'sell']),
        size: dec,
        /** null: a stop-market. */
        limitPrice: dec.nullable(),
        /** Pending mark trigger of a stop / take-profit order. */
        stop: z
          .object({ price: dec, triggersOn: z.enum(['rise', 'fall']) })
          .nullable()
          .default(null),
        ocoGroup: z.string().nullable().default(null),
      }),
    )
    .default([]),
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
  'circuit-breaker',
  'not-marketable',
  'invalid-price',
  'too-many-orders',
  'unknown-order',
  'would-trigger',
  'house-one-sided',
  'house-inventory',
  'house-loss-limit',
  'would-take',
  'invalid-order',
  'market-frozen',
  'oi-cap',
  'snap-outside-band',
]);

/** Circuit-breaker effect on a market (brief §6.5); carried on each MarketData input. */
export const breakerEffectSchema = z.enum(['none', 'no-opens', 'degraded', 'reduce-only']);
export type BreakerEffectName = z.infer<typeof breakerEffectSchema>;

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
    status: z.literal('accepted'),
    duplicate: z.boolean(),
    orderId: z.string(),
  }),
  z.object({
    requestId: z.string(),
    seq: int,
    status: z.literal('cancelled'),
    duplicate: z.boolean(),
    orderId: z.string(),
    reason: z.string(),
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
  /** Active circuit breakers and their combined effect (shown in the UI). */
  breakers: z.array(z.string()).default([]),
  breakerEffect: breakerEffectSchema.default('none'),
  /** Basket constituents dropped for missing data. */
  dropped: z.array(z.string()).default([]),
  /** EURDKK de-peg / missing feed alert. */
  fxAlert: z.boolean().default(false),
});
export type FvDisplaySnapshot = z.infer<typeof fvSnapshotSchema>;
