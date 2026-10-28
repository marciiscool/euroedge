import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { bps, feeBps, usdc } from '@euroedge/fixed';
import { fundingIndexDelta, fundingRatePerHour, liquidationPrice, settleFunding } from './index.ts';

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

  it('funding rates and settlements', async () => {
    const f = await load<{
      rateCases: {
        name: string;
        interestBpsPerYear: number;
        capPpmPerHour: number | null;
        oiCapMicroUsdc: string | null;
        netSkewMicroUsdc: string;
        ratePerHour: string;
      }[];
      settlementCases: {
        name: string;
        lots: string[];
        markTicks: string;
        tickValueMicroUsdc: string;
        ratePerHour: string;
        dtMs: string;
        paymentsMicroUsdc: string[];
        residueMicroUsdc: string;
      }[];
    }>('funding.json');
    for (const c of f.rateCases)
      expect(
        fundingRatePerHour({
          interestBpsPerYear: BigInt(c.interestBpsPerYear),
          capPpmPerHour: c.capPpmPerHour === null ? null : BigInt(c.capPpmPerHour),
          oiCap: c.oiCapMicroUsdc === null ? null : BigInt(c.oiCapMicroUsdc),
          netSkew: BigInt(c.netSkewMicroUsdc),
          quantoDrift: 0n,
        }),
        c.name,
      ).toBe(BigInt(c.ratePerHour));
    for (const c of f.settlementCases) {
      const dI = fundingIndexDelta(
        BigInt(c.markTicks),
        BigInt(c.tickValueMicroUsdc),
        BigInt(c.ratePerHour),
        BigInt(c.dtMs),
      );
      const r = settleFunding(c.lots.map((l) => BigInt(l) * dI));
      expect(r.payments, c.name).toEqual(c.paymentsMicroUsdc.map(BigInt));
      expect(r.residue, c.name).toBe(BigInt(c.residueMicroUsdc));
    }
  });
});
