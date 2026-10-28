import { parseDecimal, usdc } from '@euroedge/fixed';
import type { MarketConfig, WindowsFile } from '@euroedge/shared';
import type { EngineInput, WindowId, WindowRisk } from './core/events.ts';

/**
 * Config enters the engine only as logged input events (ADR-0001): markets.yaml +
 * windows.yaml → MarketListed.
 */
export function marketListedInput(
  m: MarketConfig,
  w: WindowsFile,
): Extract<EngineInput, { type: 'MarketListed' }> {
  const risk = (id: WindowId): WindowRisk => {
    const p = w.windows[id];
    return {
      maxLeverage: BigInt(m.kind === 'stock' ? p.stockMaxLeverage : p.basketMaxLeverage),
      takerFeeBps: BigInt(p.takerFeeBps),
      makerFeeBps: BigInt(p.makerFeeBps),
      houseHalfSpreadBps: BigInt(p.houseHalfSpreadBps),
      priceLimitBps: BigInt(p.priceLimitBps),
      fundingCapPpmPerHour: p.fundingCapPpmPerHour === null ? null : BigInt(p.fundingCapPpmPerHour),
      fundingOiCap: usdc(BigInt(p.fundingOiCapUsdc) * 1_000_000n),
      sigmaSpreadBps: BigInt(p.sigmaSpreadBps),
      inventorySkewBps: BigInt(p.inventorySkewBps),
      inventoryCap:
        p.inventoryCapUsdc === null ? null : usdc(BigInt(p.inventoryCapUsdc) * 1_000_000n),
      impactBps: BigInt(p.impactBps),
      impactRef: usdc(BigInt(p.impactRefUsdc) * 1_000_000n),
      impactAlphaHalves: p.impactAlpha === '2' ? 4n : 3n,
    };
  };
  return {
    type: 'MarketListed',
    market: m.id,
    kind: m.kind,
    tickSize: m.tickSize,
    lotSize: m.lotSize,
    // 1 EUR-point = 1 USDC per contract: min notional in EUR == USDC.
    minNotional: usdc(parseDecimal(m.minNotional, 6)),
    maintenanceMarginBps: BigInt(w.maintenanceMarginBps[m.kind]),
    fundingInterestBpsPerYear: BigInt(w.fundingInterestBpsPerYear),
    partialLiquidationBufferBps: BigInt(w.partialLiquidationBufferBps),
    flow: {
      kappaPpmPerMUsdc: BigInt(w.flow.kappaPpmPerMUsdc),
      tauSec: BigInt(w.flow.tauSec),
      walletCap: usdc(BigInt(w.flow.walletCapUsdc) * 1_000_000n),
      walletWindowSec: BigInt(w.flow.walletWindowSec),
    },
    liquidationPenaltyBps: BigInt(w.liquidationPenaltyBps[m.kind]),
    windows: { A: risk('A'), B: risk('B'), C: risk('C'), D: risk('D') },
  };
}
