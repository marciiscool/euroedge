declare const brand: unique symbol;

/**
 * A bigint tagged with its unit so different scales cannot be mixed by accident.
 * Arithmetic on branded values yields plain `bigint`; re-brand results explicitly.
 */
export type Fixed<Unit extends string> = bigint & { readonly [brand]: Unit };

/** Micro-USDC (1e-6 USDC), the on-chain unit of Test USDC. */
export type Usdc = Fixed<'Usdc'>;
/** Integer price in a market's tick size (EUR per share/unit). */
export type Ticks = Fixed<'Ticks'>;
/** Integer quantity in a market's lot size (shares/units). */
export type Lots = Fixed<'Lots'>;
/** Basis points (1e-4). */
export type Bps = Fixed<'Bps'>;
/** Parts per million (1e-6). */
export type Ppm = Fixed<'Ppm'>;
/** High-precision rate (1e-18), e.g. funding per second and funding indices. */
export type Rate = Fixed<'Rate'>;

export const USDC_SCALE = 1_000_000n;
export const BPS_SCALE = 10_000n;
export const PPM_SCALE = 1_000_000n;
export const RATE_SCALE = 1_000_000_000_000_000_000n;

export const usdc = (v: bigint): Usdc => v as Usdc;
export const ticks = (v: bigint): Ticks => v as Ticks;
export const lots = (v: bigint): Lots => v as Lots;
export const bps = (v: bigint): Bps => v as Bps;
export const ppm = (v: bigint): Ppm => v as Ppm;
export const rate = (v: bigint): Rate => v as Rate;
