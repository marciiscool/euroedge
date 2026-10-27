import { z } from 'zod';
import { currencySchema, venueSchema } from './market-data.ts';

/** Time regimes (brief §6.2), resolved per market from its venues' calendars. */
export const windowSchema = z.enum(['A', 'B', 'C', 'D']);
export type Window = z.infer<typeof windowSchema>;
export const WINDOWS = windowSchema.options;

const decimal = z.string().regex(/^\d+(\.\d+)?$/, 'decimal string, e.g. "0.01"');
const positiveDecimal = decimal.refine((v) => /[1-9]/.test(v), 'must be > 0');

export const marketIdSchema = z.string().regex(/^[A-Z0-9]+-PERP$/);
export type MarketId = z.infer<typeof marketIdSchema>;

export const adrSchema = z.object({
  venue: venueSchema,
  symbol: z.string(),
  /** Local shares per ADR (e.g. "2" for 1 ADS = 2 shares). */
  ratio: positiveDecimal,
  /** Unverified ratios get weight 0 (brief §5). */
  verified: z.boolean(),
});

/** Parameters of the simulated world for this market (sim tier only). */
export const simParamsSchema = z.object({
  startPrice: positiveDecimal,
  /** Annualised volatility of the latent price, e.g. "0.30". */
  annualVol: positiveDecimal,
  /** Expected jumps per trading year and their stdev in log terms. */
  jumpsPerYear: decimal,
  jumpVol: decimal,
});

export const marketConfigSchema = z.object({
  id: marketIdSchema,
  displayName: z.string(),
  underlyingIsin: z.string().regex(/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/),
  kind: z.enum(['stock', 'basket']),
  primaryMic: venueSchema,
  quoteCcy: z.literal('EUR'),
  primaryCcy: currencySchema,
  priceSourceOverride: z.object({ venue: venueSchema, ccy: currencySchema }).optional(),
  tickSize: positiveDecimal,
  lotSize: positiveDecimal,
  minNotional: positiveDecimal,
  adr: adrSchema.optional(),
  tradegateSymbol: z.string().optional(),
  sector: z.string(),
  enabled: z.boolean(),
  sim: simParamsSchema.optional(),
});
export type MarketConfig = z.infer<typeof marketConfigSchema>;

export const marketsFileSchema = z
  .object({ markets: z.array(marketConfigSchema).min(1) })
  .refine((f) => new Set(f.markets.map((m) => m.id)).size === f.markets.length, {
    message: 'duplicate market id',
  });

const leverage = z.number().int().min(1).max(20);
const bps = z.number().int().min(0).max(10_000);

/** Risk parameters per window (brief §7.2, ADR-0016). Integers only: bps, ppm, leverage. */
export const windowParamsSchema = z.object({
  /** Max leverage on new exposure for stocks; 0 = reduce-only. */
  stockMaxLeverage: z.number().int().min(0).max(20),
  basketMaxLeverage: leverage,
  /** Max deviation of any fill from the index. */
  priceLimitBps: bps,
  takerFeeBps: bps,
  makerFeeBps: bps,
  /** v1 testnet house quote: FV ± halfSpread before size impact (ADR-0003). */
  houseHalfSpreadBps: bps,
  /** Hourly funding cap on the total rate, ppm; null = interest only (Window D). */
  fundingCapPpmPerHour: z.number().int().min(0).nullable(),
});
export type WindowParams = z.infer<typeof windowParamsSchema>;

export const windowsFileSchema = z.object({
  windows: z.object({
    A: windowParamsSchema,
    B: windowParamsSchema,
    C: windowParamsSchema,
    D: windowParamsSchema,
  }),
  /** Constant across windows (ESMA 50 % close-out at max leverage). */
  maintenanceMarginBps: z.object({ stock: bps, basket: bps }),
  /** Liquidation penalty to the insurance fund (ADR-0016). */
  liquidationPenaltyBps: z.object({ stock: bps, basket: bps }),
  /** Funding interest component, longs pay shorts (ADR-0016). */
  fundingInterestBpsPerYear: bps,
  /** Mark step cap outside SNAP (ADR-0009). */
  markStepCapBpsPerSecond: bps,
});
export type WindowsFile = z.infer<typeof windowsFileSchema>;
