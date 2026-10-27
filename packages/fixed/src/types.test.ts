import { describe, expect, it } from 'vitest';
import { bps, lots, ppm, rate, RATE_SCALE, ticks, usdc, USDC_SCALE } from './types.ts';

describe('branded constructors', () => {
  it('are identity at runtime', () => {
    for (const make of [usdc, ticks, lots, bps, ppm, rate]) expect(make(42n)).toBe(42n);
  });

  it('scales', () => {
    expect(USDC_SCALE).toBe(10n ** 6n);
    expect(RATE_SCALE).toBe(10n ** 18n);
  });
});
