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
  /** Local shares per ADR (e.g. "2" for 1 ADS = 2 shares, "0.2" for 5 ADRs = 1 share). */
  ratio: positiveDecimal,
  /** Unverified ratios get weight 0 (brief §5). */
  verified: z.boolean(),
});
export type AdrConfig = z.infer<typeof adrSchema>;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
const isin = z.string().regex(/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/);

/** Parameters of the simulated world for one underlying (sim tier only; config/sim.yaml has the rest). */
export const simParamsSchema = z.object({
  /** Start price in EUR (converted to the primary currency by the simulator). */
  startPrice: positiveDecimal,
  /** Annualised total volatility, e.g. "0.30". Split into market, sector and idiosyncratic parts. */
  annualVol: positiveDecimal,
  /** Loading on the common market factor (default 1). */
  beta: decimal.optional(),
  /** Expected jumps per trading year and their stdev in log terms. */
  jumpsPerYear: decimal,
  jumpVol: decimal,
  /** Simulated dividends (gross, EUR per share). The ADR line may go ex on a different date. */
  dividends: z
    .array(
      z.object({ exDate: isoDate, gross: positiveDecimal, adrExDate: isoDate.optional() }).strict(),
    )
    .default([]),
});
export type SimParams = z.infer<typeof simParamsSchema>;

/** A listed share: the underlying of a stock perp or a basket constituent. */
export const underlyingSchema = z.object({
  underlyingIsin: isin,
  primaryMic: venueSchema,
  /** Symbol on the primary venue (e.g. "NOVO B"). */
  primarySymbol: z.string().min(1),
  /** Currency of the primary line; GBX is converted /100 then via EURGBP, DKK via EURDKK. */
  primaryCcy: currencySchema,
  adr: adrSchema.optional(),
  tradegateSymbol: z.string().optional(),
  sector: z.string(),
  sim: simParamsSchema.optional(),
});
export type UnderlyingConfig = z.infer<typeof underlyingSchema>;

const weightBps = z.number().int().min(1).max(10_000);

/** A basket constituent: a reference to a listed perp, or an inline underlying. */
export const constituentSchema = z.union([
  z
    .object({ id: z.string().min(1), market: z.string().regex(/^[A-Z0-9]+-PERP$/), weightBps })
    .strict(),
  underlyingSchema.extend({ id: z.string().min(1), name: z.string().min(1), weightBps }).strict(),
]);
export type ConstituentConfig = z.infer<typeof constituentSchema>;

export const basketSchema = z
  .object({
    /** draft = constituents and weights still need founder sign-off (PLAN §8). */
    status: z.enum(['draft', 'approved']),
    methodology: z.string(),
    /** Level at the base date; the divisor is set by the engine's rebalance event (M3-10). */
    startLevel: positiveDecimal,
    capBps: weightBps,
    rebalance: z.enum(['quarterly']),
    constituents: z.array(constituentSchema).min(2),
  })
  .strict()
  .superRefine((b, ctx) => {
    const total = b.constituents.reduce((a, c) => a + c.weightBps, 0);
    if (total !== 10_000)
      ctx.addIssue({ code: 'custom', message: `weights sum to ${total}, not 10000` });
    for (const c of b.constituents)
      if (c.weightBps > b.capBps)
        ctx.addIssue({
          code: 'custom',
          message: `${c.id} weight ${c.weightBps} exceeds cap ${b.capBps}`,
        });
    if (new Set(b.constituents.map((c) => c.id)).size !== b.constituents.length)
      ctx.addIssue({ code: 'custom', message: 'duplicate constituent id' });
  });
export type BasketConfig = z.infer<typeof basketSchema>;

export const marketConfigSchema = underlyingSchema
  .extend({
    id: marketIdSchema,
    displayName: z.string(),
    kind: z.enum(['stock', 'basket']),
    // Stocks: the share's ISIN. Baskets have none.
    underlyingIsin: isin.optional(),
    // Stocks: primary listing. Baskets: the calendar that defines Window A.
    primaryMic: venueSchema,
    primarySymbol: z.string().min(1).optional(),
    /** Venue whose session outside Window A is Window B (brief §6.2). */
    extendedMic: venueSchema.default('TGAT'),
    quoteCcy: z.literal('EUR'),
    /** EUR line used for the Tradegate signal and the Window A index when the primary is not EUR (ADR-0017). */
    priceSourceOverride: z.object({ venue: venueSchema, ccy: currencySchema }).optional(),
    /** An alternative EUR line, disabled by default (SHEL on XAMS, ADR-0017). */
    alternativeEurLine: z
      .object({ venue: venueSchema, symbol: z.string(), enabled: z.boolean() })
      .optional(),
    tickSize: positiveDecimal,
    lotSize: positiveDecimal,
    minNotional: positiveDecimal,
    betaToBasket: decimal.optional(),
    earningsCalendarRef: z.string().optional(),
    dividendCalendarRef: z.string().optional(),
    enabled: z.boolean(),
    /** Why a market is disabled, shown to operators. */
    launchNote: z.string().optional(),
    basket: basketSchema.optional(),
  })
  .superRefine((m, ctx) => {
    const issue = (message: string) =>
      ctx.addIssue({ code: 'custom', message: `${m.id}: ${message}` });
    if (m.kind === 'stock') {
      if (m.underlyingIsin === undefined) issue('stocks need underlyingIsin');
      if (m.primarySymbol === undefined) issue('stocks need primarySymbol');
      if (m.basket !== undefined) issue('stocks have no basket');
      if (m.primaryCcy !== 'EUR' && m.priceSourceOverride?.ccy !== 'EUR')
        issue('a non-EUR primary needs a EUR priceSourceOverride (ADR-0017)');
    } else {
      if (m.basket === undefined) issue('baskets need a basket definition');
      if (m.primaryCcy !== 'EUR') issue('baskets are computed in EUR');
    }
  });
export type MarketConfig = z.infer<typeof marketConfigSchema>;

export const marketsFileSchema = z
  .object({ markets: z.array(marketConfigSchema).min(1) })
  .superRefine((f, ctx) => {
    const ids = new Set(f.markets.map((m) => m.id));
    if (ids.size !== f.markets.length)
      ctx.addIssue({ code: 'custom', message: 'duplicate market id' });
    for (const m of f.markets)
      for (const c of m.basket?.constituents ?? [])
        if ('market' in c && f.markets.find((x) => x.id === c.market)?.kind !== 'stock')
          ctx.addIssue({
            code: 'custom',
            message: `${m.id}: constituent ${c.id} references unknown stock ${c.market}`,
          });
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
