import { instrumentKey, type Currency, type InstrumentRef, type Tick } from '@euroedge/shared';
import type { MarketDataProvider, ProviderHealth, Unsubscribe } from '../provider.ts';
import { ProviderNotConfiguredError } from './meta.ts';

/** Pyth symbols for US listings and FX (Pyth has no Xetra/Euronext feeds, brief §4.2). */
export function pythSymbol(i: InstrumentRef): string | undefined {
  if (i.venue === 'FX' && /^[A-Z]{6}$/.test(i.symbol))
    return `FX.${i.symbol.slice(0, 3)}/${i.symbol.slice(3)}`;
  if (i.venue === 'XNAS' || i.venue === 'XNYS' || i.venue === 'OTCM')
    return `Equity.US.${i.symbol}/USD`;
  return undefined;
}

/** Minimal transport so tests run against recorded fixtures and never reach the network. */
export interface PythTransport {
  connect(
    onMessage: (raw: string) => void,
    onClose: () => void,
  ): { send(raw: string): void; close(): void };
}

export interface PythProviderOptions {
  /** PYTH_API_KEY. Without it the provider refuses to start and makes no request. */
  readonly apiKey: string | undefined;
  readonly transport: PythTransport;
  /** Pyth feed id per Pyth symbol (from the Pyth symbols list; founder to confirm coverage). */
  readonly feedIds: Readonly<Record<string, number>>;
  readonly now?: () => number;
}

interface FeedUpdate {
  priceFeedId: number;
  price?: string;
  bestBidPrice?: string;
  bestAskPrice?: string;
  exponent?: number;
}

/**
 * Parses one streamed message into ticks. ASSUMPTION (unverified until the founder's key arrives):
 * Pyth Pro JSON `{type: "streamUpdated", parsed: {timestampUs, priceFeeds: [...]}}` with integer
 * mantissas and a decimal exponent. Recorded-fixture tests pin this shape.
 */
export function parsePythMessage(raw: string, byFeed: ReadonlyMap<number, InstrumentRef>): Tick[] {
  const msg = JSON.parse(raw) as {
    type?: string;
    parsed?: { timestampUs?: string; priceFeeds?: FeedUpdate[] };
  };
  if (msg.type !== 'streamUpdated' || msg.parsed === undefined) return [];
  const ts = Math.floor(Number(msg.parsed.timestampUs ?? '0') / 1000);
  const out: Tick[] = [];
  for (const f of msg.parsed.priceFeeds ?? []) {
    const instrument = byFeed.get(f.priceFeedId);
    if (instrument === undefined || f.exponent === undefined) continue;
    const e = f.exponent;
    // Dividing by 10^k keeps decimal mantissas exact where multiplying by 10^-k would not.
    const px = (v: string | undefined) =>
      v === undefined ? undefined : e < 0 ? Number(v) / 10 ** -e : Number(v) * 10 ** e;
    const bid = px(f.bestBidPrice);
    const ask = px(f.bestAskPrice);
    const currency: Currency =
      instrument.venue === 'FX' ? (instrument.symbol.slice(3) as Currency) : 'USD';
    if (bid !== undefined && ask !== undefined && bid > 0 && ask >= bid)
      out.push({ source: 'pyth', instrument, ts, currency, kind: 'quote', bid, ask });
    else if (px(f.price) !== undefined)
      out.push({ source: 'pyth', instrument, ts, currency, kind: 'trade', last: px(f.price) ?? 0 });
  }
  return out;
}

/** Pyth Pro stream for ADRs and EUR/USD (live-min tier). Never connects without a key. */
export class PythProvider implements MarketDataProvider {
  readonly id = 'pyth' as const;
  private readonly opts: PythProviderOptions;
  private readonly now: () => number;
  private lastTickAt: number | undefined;
  private messages = 0;
  private errors = 0;
  private connected = false;

  constructor(opts: PythProviderOptions) {
    if (opts.apiKey === undefined || opts.apiKey === '')
      throw new ProviderNotConfiguredError('pyth', 'PYTH_API_KEY is not set');
    this.opts = opts;
    this.now = opts.now ?? Date.now;
  }

  subscribe(instruments: readonly InstrumentRef[], onTick: (t: Tick) => void): Unsubscribe {
    const byFeed = new Map<number, InstrumentRef>();
    for (const i of instruments) {
      const sym = pythSymbol(i);
      const id = sym === undefined ? undefined : this.opts.feedIds[sym];
      if (id === undefined) throw new Error(`no Pyth feed for ${instrumentKey(i)}`);
      byFeed.set(id, i);
    }
    const conn = this.opts.transport.connect(
      (raw) => {
        this.messages++;
        try {
          for (const t of parsePythMessage(raw, byFeed)) {
            this.lastTickAt = this.now();
            onTick(t);
          }
        } catch {
          this.errors++;
        }
      },
      () => {
        this.connected = false;
      },
    );
    this.connected = true;
    conn.send(
      JSON.stringify({
        type: 'subscribe',
        subscriptionId: 1,
        priceFeedIds: [...byFeed.keys()],
        properties: ['price', 'bestBidPrice', 'bestAskPrice', 'exponent'],
        channel: 'fixed_rate@200ms',
      }),
    );
    return () => {
      conn.close();
      this.connected = false;
    };
  }

  health(): ProviderHealth {
    return {
      connected: this.connected,
      lastTickAgeMs: this.lastTickAt === undefined ? undefined : this.now() - this.lastTickAt,
      errorRate: this.messages === 0 ? 0 : this.errors / this.messages,
    };
  }
}
