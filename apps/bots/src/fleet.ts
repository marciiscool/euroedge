import type { Intent, Random, Strategy } from './strategies.ts';

/** How bots see the venue and trade on it; the HMAC API client (M6-03) replaces the stream. */
export interface BotTransport {
  /** Current mark, FV and house bid/ask, or undefined while the market has no data. */
  quote(market: string): Promise<Quote | undefined>;
  /** Signed position in lots. */
  position(account: string, market: string): Promise<bigint>;
  /** One-time play-money credit (sim tier only). */
  fund(account: string): Promise<void>;
  place(account: string, market: string, intent: Intent, requestId: string): Promise<void>;
}

export interface Quote {
  readonly mark: number;
  readonly fv: number;
  readonly bid: number;
  readonly ask: number;
}

export interface Bot {
  readonly account: string;
  readonly strategy: Strategy;
}

/** `count` accounts, strategies assigned round-robin: bot-<strategy>-<n>. */
export function makeBots(count: number, strategies: readonly Strategy[]): Bot[] {
  return Array.from({ length: count }, (_, i) => {
    const strategy = strategies[i % strategies.length];
    if (strategy === undefined) throw new Error('no strategies');
    return { account: `bot-${strategy.name}-${String(i).padStart(3, '0')}`, strategy };
  });
}

/** Scheduler (M4-23): each tick reads the marks, then lets every bot decide once. */
export class BotFleet {
  private readonly history = new Map<string, number[]>();
  private readonly bots: readonly Bot[];
  private readonly markets: readonly string[];
  private readonly transport: BotTransport;
  private readonly rng: Random;
  private readonly keep: number;
  private n = 0;

  constructor(
    bots: readonly Bot[],
    markets: readonly string[],
    transport: BotTransport,
    rng: Random,
    keep = 200,
  ) {
    this.bots = bots;
    this.markets = markets;
    this.transport = transport;
    this.rng = rng;
    this.keep = keep;
  }

  async fundAll(): Promise<void> {
    for (const b of this.bots) await this.transport.fund(b.account);
  }

  /** One round; returns the number of orders sent. */
  async tick(): Promise<number> {
    let sent = 0;
    for (const market of this.markets) {
      const quote = await this.transport.quote(market);
      if (quote === undefined) continue;
      const marks = this.history.get(market) ?? [];
      marks.push(quote.mark);
      if (marks.length > this.keep) marks.shift();
      this.history.set(market, marks);
      for (const bot of this.bots) {
        const position = await this.transport.position(bot.account, market);
        const intent = bot.strategy.decide(
          { marks, position, fv: quote.fv, bid: quote.bid, ask: quote.ask },
          this.rng,
        );
        if (intent === null || intent.lots <= 0n) continue;
        this.n += 1;
        await this.transport.place(bot.account, market, intent, `${bot.account}-${this.n}`);
        sent += 1;
      }
    }
    return sent;
  }
}
