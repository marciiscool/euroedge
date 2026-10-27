import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { resolveUnits } from '@euroedge/fixed';
import { fvParamsSchema, type FvParams } from '../fv-params.ts';
import { simConfigSchema, type SimConfig } from '../sim-config.ts';
import {
  marketsFileSchema,
  windowsFileSchema,
  type MarketConfig,
  type WindowsFile,
} from '../markets.ts';
import { ConfigError } from './errors.ts';
import { loadYamlConfig } from './yaml.ts';

/** Repo `config/` directory unless CONFIG_DIR is set. */
export const configDir = (): string =>
  process.env['CONFIG_DIR'] ?? fileURLToPath(new URL('../../../../config', import.meta.url));

export async function loadMarkets(dir = configDir()): Promise<MarketConfig[]> {
  const file = join(dir, 'markets.yaml');
  const { markets } = await loadYamlConfig(file, marketsFileSchema);
  // Every market must have an integer µUSDC tick value (ADR-0002).
  const bad = markets.flatMap((m) => {
    try {
      resolveUnits(m);
      return [];
    } catch (err) {
      return [`${m.id}: ${err instanceof Error ? err.message : String(err)}`];
    }
  });
  if (bad.length > 0) throw new ConfigError(file, bad);
  return markets;
}

export const loadWindows = (dir = configDir()): Promise<WindowsFile> =>
  loadYamlConfig(join(dir, 'windows.yaml'), windowsFileSchema);

export const loadFvParams = (dir = configDir()): Promise<FvParams> =>
  loadYamlConfig(join(dir, 'fv.yaml'), fvParamsSchema);

export const loadSimConfig = (dir = configDir()): Promise<SimConfig> =>
  loadYamlConfig(join(dir, 'sim.yaml'), simConfigSchema);
