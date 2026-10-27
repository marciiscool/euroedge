import { describe, expect, it } from 'vitest';
import { tierFeatures } from './data-tier.ts';

describe('tierFeatures', () => {
  it('watermarks and gates non-live tiers', () => {
    for (const tier of ['sim', 'replay'] as const) {
      expect(tierFeatures(tier)).toEqual({
        simulatedWatermark: true,
        leaderboard: false,
        modelAccuracyPage: false,
        paidProviders: false,
      });
    }
  });

  it('enables public features only in live-min', () => {
    expect(tierFeatures('live-min')).toEqual({
      simulatedWatermark: false,
      leaderboard: true,
      modelAccuracyPage: true,
      paidProviders: true,
    });
  });
});
