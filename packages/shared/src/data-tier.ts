import { z } from 'zod';

/** Brief §4.1. `sim` is the default; public launch requires `live-min`. */
export const dataTierSchema = z.enum(['sim', 'replay', 'live-min']);
export type DataTier = z.infer<typeof dataTierSchema>;

export interface TierFeatures {
  /** Every displayed price carries the "SIMULATED PRICES" watermark. */
  readonly simulatedWatermark: boolean;
  readonly leaderboard: boolean;
  readonly modelAccuracyPage: boolean;
  /** Whether paid providers (Pyth Pro, Tradegate vendor) may be called at all. */
  readonly paidProviders: boolean;
}

export function tierFeatures(tier: DataTier): TierFeatures {
  const live = tier === 'live-min';
  return {
    simulatedWatermark: !live,
    leaderboard: live,
    modelAccuracyPage: live,
    paidProviders: live,
  };
}
