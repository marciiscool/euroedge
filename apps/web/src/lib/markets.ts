/** Markets enabled in config/markets.yaml. GET /api/markets replaces this list in M6. */
export const MARKETS = [
  { id: 'ASML-PERP', name: 'ASML Holding' },
  { id: 'SAP-PERP', name: 'SAP' },
  { id: 'SIE-PERP', name: 'Siemens' },
  { id: 'TTE-PERP', name: 'TotalEnergies' },
  { id: 'MC-PERP', name: 'LVMH' },
] as const;

export type MarketId = (typeof MARKETS)[number]['id'];

export const marketById = (id: string | null | undefined) =>
  MARKETS.find((m) => m.id === id) ?? MARKETS[0];
