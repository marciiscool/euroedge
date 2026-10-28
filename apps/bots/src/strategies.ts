/**
 * Bot strategies (M4-24). Pure: a decision depends only on the price history, the bot's
 * position and its seeded random source, so a run is reproducible from the seed. Prices are
 * signals only (floats are fine outside the engine core); sizes are integer lots.
 */
export interface Random {
  uniform(): number;
}

export interface BotView {
  /** Recent marks, oldest first; the last one is current. */
  readonly marks: readonly number[];
  /** Signed position in lots. */
  readonly position: bigint;
  /** Current fair value and the house's best bid/ask, when known. */
  readonly fv?: number;
  readonly bid?: number;
  readonly ask?: number;
}

export interface Intent {
  readonly side: 'buy' | 'sell';
  readonly lots: bigint;
  readonly reduceOnly: boolean;
}

export interface Strategy {
  readonly name: string;
  decide(view: BotView, rng: Random): Intent | null;
}

export interface Sizing {
  /** Chance to act on a tick. */
  readonly activity: number;
  readonly minLots: bigint;
  readonly maxLots: bigint;
  /** |position| beyond which the bot only reduces. */
  readonly maxPosition: bigint;
}

export const DEFAULT_SIZING: Sizing = {
  activity: 0.2,
  minLots: 10n,
  maxLots: 500n,
  maxPosition: 2_000n,
};

const size = (s: Sizing, rng: Random): bigint =>
  s.minLots + BigInt(Math.floor(rng.uniform() * Number(s.maxLots - s.minLots + 1n)));

/** Keeps a bot inside its position limit: past it, it trades back toward flat. */
function bounded(view: BotView, s: Sizing, side: 'buy' | 'sell', lots: bigint): Intent {
  const after = view.position + (side === 'buy' ? lots : -lots);
  if (after > s.maxPosition || after < -s.maxPosition) {
    const back = view.position > 0n ? 'sell' : 'buy';
    const abs = view.position < 0n ? -view.position : view.position;
    return { side: back, lots: lots < abs ? lots : abs, reduceOnly: true };
  }
  return { side, lots, reduceOnly: false };
}

/** Random side and size: background liquidity demand. */
export const noise = (s: Sizing = DEFAULT_SIZING): Strategy => ({
  name: 'noise',
  decide(view, rng) {
    if (view.marks.length === 0 || rng.uniform() >= s.activity) return null;
    return bounded(view, s, rng.uniform() < 0.5 ? 'buy' : 'sell', size(s, rng));
  },
});

/** Follows the move over `lookback` ticks when it exceeds `threshold` (fraction). */
export const momentum = (
  lookback = 10,
  threshold = 0.001,
  s: Sizing = DEFAULT_SIZING,
): Strategy => ({
  name: 'momentum',
  decide(view, rng) {
    const n = view.marks.length;
    if (n <= lookback || rng.uniform() >= s.activity) return null;
    const now = view.marks[n - 1] ?? 0;
    const then = view.marks[n - 1 - lookback] ?? now;
    const r = now / then - 1;
    if (Math.abs(r) < threshold) return null;
    return bounded(view, s, r > 0 ? 'buy' : 'sell', size(s, rng));
  },
});

/** Fades the deviation from an exponential average with smoothing `alpha`. */
export const meanReversion = (
  alpha = 0.1,
  threshold = 0.001,
  s: Sizing = DEFAULT_SIZING,
): Strategy => ({
  name: 'mean-reversion',
  decide(view, rng) {
    const n = view.marks.length;
    if (n < 2 || rng.uniform() >= s.activity) return null;
    let ewma = view.marks[0] ?? 0;
    for (const m of view.marks) ewma += alpha * (m - ewma);
    const dev = (view.marks[n - 1] ?? ewma) / ewma - 1;
    if (Math.abs(dev) < threshold) return null;
    return bounded(view, s, dev > 0 ? 'sell' : 'buy', size(s, rng));
  },
});

/**
 * Whale (M4-26): rare, very large orders. Trades never move the mark (only market data
 * does), so a whale cannot push others into liquidation; the engine tests assert this.
 */
export const whale = (
  s: Sizing = { activity: 0.02, minLots: 50_000n, maxLots: 250_000n, maxPosition: 1_000_000n },
): Strategy => ({
  name: 'whale',
  decide(view, rng) {
    if (view.marks.length === 0 || rng.uniform() >= s.activity) return null;
    return bounded(view, s, rng.uniform() < 0.5 ? 'buy' : 'sell', size(s, rng));
  },
});

/**
 * Arbitrageur (M4-25): buys when FV is above the ask by `edge` (fraction), sells when it is
 * below the bid. Live it only sees the current FV; the engine simulation gives it the next one.
 */
export const arbitrageur = (
  edge = 0.0015,
  s: Sizing = { ...DEFAULT_SIZING, activity: 1 },
): Strategy => ({
  name: 'arbitrageur',
  decide(view, rng) {
    const { fv, bid, ask } = view;
    if (fv === undefined || bid === undefined || ask === undefined || rng.uniform() >= s.activity)
      return null;
    if (fv > ask * (1 + edge)) return bounded(view, s, 'buy', size(s, rng));
    if (fv < bid * (1 - edge)) return bounded(view, s, 'sell', size(s, rng));
    return null;
  },
});
