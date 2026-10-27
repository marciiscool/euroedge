'use client';

import { useEffect, useState } from 'react';

export interface MarketListing {
  readonly id: string;
  readonly displayName: string;
}

/** Shown until GET /api/markets answers, and if it fails. */
const FALLBACK: readonly MarketListing[] = [{ id: 'ASML-PERP', displayName: 'ASML Holding' }];

let cache: Promise<readonly MarketListing[]> | undefined;

function fetchMarkets(): Promise<readonly MarketListing[]> {
  cache ??= fetch('/api/markets')
    .then((r) => (r.ok ? (r.json() as Promise<{ markets: MarketListing[] }>) : { markets: [] }))
    .then((b) => (b.markets.length > 0 ? b.markets : FALLBACK))
    .catch(() => {
      cache = undefined;
      return FALLBACK;
    });
  return cache;
}

/** Enabled markets from the server (config/markets.yaml): new tickers appear without a web change. */
export function useMarkets(): readonly MarketListing[] {
  const [markets, setMarkets] = useState<readonly MarketListing[]>(FALLBACK);
  useEffect(() => {
    let live = true;
    void fetchMarkets().then((m) => {
      if (live) setMarkets(m);
    });
    return () => {
      live = false;
    };
  }, []);
  return markets;
}
