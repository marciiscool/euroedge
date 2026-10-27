import { z } from 'zod';

/** Market-data source (brief §4). Paid sources are only used in the live-min tier. */
export const sourceIdSchema = z.enum([
  'sim',
  'replay',
  'pyth',
  'tradegate',
  'xetra-delayed',
  'eurex',
]);
export type SourceId = z.infer<typeof sourceIdSchema>;

/** Venue MIC, or FX for currency pairs. */
export const venueSchema = z.enum([
  'XETR',
  'XAMS',
  'XPAR',
  'XCSE',
  'XLON',
  'TGAT',
  'XNYS',
  'XNAS',
  'XEUR',
  'FX',
]);
export type Venue = z.infer<typeof venueSchema>;

export const instrumentRefSchema = z.object({
  venue: venueSchema,
  symbol: z.string().min(1),
});
export type InstrumentRef = z.infer<typeof instrumentRefSchema>;

export const instrumentKey = (i: InstrumentRef): string => `${i.venue}:${i.symbol}`;

export const currencySchema = z.enum(['EUR', 'USD', 'GBP', 'GBX', 'DKK']);
export type Currency = z.infer<typeof currencySchema>;

/**
 * A normalized market-data tick (brief §4). Prices are plain numbers: market data is an
 * input to fv-core (floats allowed there) and never enters the engine un-quantized.
 */
export const tickSchema = z.object({
  source: sourceIdSchema,
  instrument: instrumentRefSchema,
  /** Exchange timestamp, UTC ms. */
  ts: z.number().int().nonnegative(),
  bid: z.number().positive().optional(),
  ask: z.number().positive().optional(),
  last: z.number().positive().optional(),
  size: z.number().nonnegative().optional(),
  currency: currencySchema,
  kind: z.enum(['quote', 'trade', 'auction', 'indicative', 'close']),
});
export type Tick = z.infer<typeof tickSchema>;
