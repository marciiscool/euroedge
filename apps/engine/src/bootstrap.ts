import { usdc } from '@euroedge/fixed';
import type { DataTier, MarketConfig, WindowsFile } from '@euroedge/shared';
import type { EngineInput } from './core/events.ts';
import type { EngineState } from './core/state.ts';
import { canonicalJson } from './log/canonical.ts';
import { marketListedInput } from './market-config.ts';

const USDC = 1_000_000n;
/** ADR-0013 genesis capital (founder, 2026-10-27). */
export const GENESIS = { house: 50_000_000n * USDC, insurance: 5_000_000n * USDC } as const;

/**
 * Inputs needed to bring the logged state in line with config: genesis capital (sim/replay
 * tiers; on-chain genesis arrives in M5) and a MarketListed for each enabled market whose
 * logged spec differs from config. Everything goes through the log like any other input.
 */
export function bootstrapInputs(
  state: EngineState,
  markets: readonly MarketConfig[],
  windows: WindowsFile,
  tier: DataTier,
): EngineInput[] {
  const inputs: EngineInput[] = [];
  if (!state.genesis && tier !== 'live-min') {
    inputs.push({
      type: 'GenesisCapital',
      house: usdc(GENESIS.house),
      insurance: usdc(GENESIS.insurance),
      source: 'dev',
    });
  }
  for (const m of markets.filter((x) => x.enabled)) {
    const desired = marketListedInput(m, windows);
    const cur = state.markets.get(m.id);
    const same =
      cur !== undefined &&
      canonicalJson({
        kind: cur.kind,
        tickSize: cur.units.tickSize,
        lotSize: cur.units.lotSize,
        minNotional: cur.minNotional,
        mm: cur.maintenanceMarginBps,
        pen: cur.liquidationPenaltyBps,
        windows: cur.windows,
      }) ===
        canonicalJson({
          kind: desired.kind,
          tickSize: desired.tickSize,
          lotSize: desired.lotSize,
          minNotional: desired.minNotional,
          mm: desired.maintenanceMarginBps,
          pen: desired.liquidationPenaltyBps,
          windows: desired.windows,
        });
    if (!same) inputs.push(desired);
  }
  return inputs;
}
