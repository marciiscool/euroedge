import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { bps, feeBps, usdc } from '@euroedge/fixed';
import { liquidationPrice } from './index.ts';

const load = async <T>(name: string): Promise<T> =>
  JSON.parse(
    await readFile(new URL(`../../../docs/methodology/examples/${name}`, import.meta.url), 'utf8'),
  ) as T;

interface LiqCase {
  name: string;
  cashMicroUsdc: string;
  lots: string;
  costTicksLots: string;
  tickValueMicroUsdc: string;
  mmBps: number;
  liquidationPriceTicks: string;
}

describe('golden vectors (docs/methodology/examples)', () => {
  it('fees round up', async () => {
    const f = await load<{
      cases: { name: string; notionalMicroUsdc: string; bps: number; feeMicroUsdc: string }[];
    }>('fees.json');
    for (const c of f.cases)
      expect(feeBps(usdc(BigInt(c.notionalMicroUsdc)), bps(BigInt(c.bps))), c.name).toBe(
        BigInt(c.feeMicroUsdc),
      );
  });

  it('liquidation prices', async () => {
    const f = await load<{ cases: LiqCase[] }>('liquidation-price.json');
    for (const c of f.cases)
      expect(
        liquidationPrice(
          usdc(BigInt(c.cashMicroUsdc)),
          BigInt(c.lots),
          BigInt(c.costTicksLots),
          usdc(BigInt(c.tickValueMicroUsdc)),
          BigInt(c.mmBps),
        ),
        c.name,
      ).toBe(BigInt(c.liquidationPriceTicks));
  });
});
