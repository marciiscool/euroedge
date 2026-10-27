import type { DataTier, SourceId } from '@euroedge/shared';

/** Licence facts per source (brief §4: data-licence hygiene). */
export interface SourceMeta {
  readonly id: SourceId;
  /** Raw ticks may reach users only when true; otherwise users see derived values only. */
  readonly redistributionAllowed: boolean;
  /** Footer attribution shown in the UI. */
  readonly attribution: string;
}

export const SOURCE_META: Readonly<Record<SourceId, SourceMeta>> = {
  sim: { id: 'sim', redistributionAllowed: true, attribution: 'Simulated prices (EuroEdge)' },
  replay: {
    id: 'replay',
    redistributionAllowed: true,
    attribution: 'Replayed sample data (EuroEdge)',
  },
  pyth: {
    id: 'pyth',
    redistributionAllowed: false,
    attribution: 'US listings and FX: Pyth Network',
  },
  tradegate: {
    id: 'tradegate',
    redistributionAllowed: false,
    attribution: 'Tradegate Exchange (vendor TBD)',
  },
  'xetra-delayed': {
    id: 'xetra-delayed',
    redistributionAllowed: false,
    attribution: 'Xetra, 15 min delayed (Deutsche Börse)',
  },
  eurex: { id: 'eurex', redistributionAllowed: false, attribution: 'Eurex (Deutsche Börse)' },
};

export class ProviderNotConfiguredError extends Error {
  constructor(id: SourceId, what: string) {
    super(`${id} provider is not configured: ${what}`);
    this.name = 'ProviderNotConfiguredError';
  }
}

/** Sources each data tier runs on (brief §4.1). live-min needs Tradegate + Pyth (ADRs, EUR/USD). */
export function sourcesForTier(tier: DataTier): readonly SourceId[] {
  switch (tier) {
    case 'sim':
      return ['sim'];
    case 'replay':
      return ['replay'];
    case 'live-min':
      return ['tradegate', 'pyth'];
  }
}
