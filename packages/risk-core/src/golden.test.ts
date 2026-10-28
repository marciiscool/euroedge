import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { bps, feeBps, ticks, usdc } from '@euroedge/fixed';
import { liquidationPrice, quotePrice } from './index.ts';

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

  it('house quotes', async () => {
    interface QuoteCase {
      name: string;
      params: {
        halfSpreadBps: number;
        sigmaSpreadBps: number;
        inventorySkewBps: number;
        inventoryCapMicroUsdc: number | null;
        impactBps: number;
        impactRefMicroUsdc: number;
        impactAlpha: '1.5' | '2';
      };
      inputs: {
        fv: number;
        sigmaPpm: number;
        inventoryMicroUsdc: number;
        shiftPpm: number;
        spreadMultiplier: number;
      };
      notionalMicroUsdc: number;
      ask: number;
      bid: number;
    }
    const f = await load<{ cases: QuoteCase[] }>('quote.json');
    for (const c of f.cases) {
      const p = {
        halfSpreadBps: BigInt(c.params.halfSpreadBps),
        sigmaSpreadBps: BigInt(c.params.sigmaSpreadBps),
        inventorySkewBps: BigInt(c.params.inventorySkewBps),
        inventoryCap:
          c.params.inventoryCapMicroUsdc === null ? null : BigInt(c.params.inventoryCapMicroUsdc),
        impactBps: BigInt(c.params.impactBps),
        impactRef: BigInt(c.params.impactRefMicroUsdc),
        impactAlphaHalves: c.params.impactAlpha === '2' ? 4n : 3n,
      };
      const q = {
        fv: ticks(BigInt(c.inputs.fv)),
        sigmaPpm: BigInt(c.inputs.sigmaPpm),
        inventory: BigInt(c.inputs.inventoryMicroUsdc),
        shiftPpm: BigInt(c.inputs.shiftPpm),
        spreadMultiplier: BigInt(c.inputs.spreadMultiplier),
      };
      const n = BigInt(c.notionalMicroUsdc);
      expect(quotePrice(p, q, 1n, n), `${c.name} ask`).toBe(BigInt(c.ask));
      expect(quotePrice(p, q, -1n, n), `${c.name} bid`).toBe(BigInt(c.bid));
    }
  });
});
