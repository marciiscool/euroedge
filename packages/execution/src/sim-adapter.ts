import { randomUUID } from 'node:crypto';
import { priceToTicks, qtyToLots } from '@euroedge/fixed';
import type { Redis } from '@euroedge/service-kit';
import {
  accountSnapshotSchema,
  CHANNELS,
  encodeEngineCommand,
  ENGINE_STREAM_MAXLEN,
  KEYS,
  marketSnapshotSchema,
  orderResultSchema,
  STREAMS,
  type AccountSnapshot,
  type OrderResult,
  type PositionView,
} from '@euroedge/shared';
import {
  ExecutionError,
  type ExecutionAdapter,
  type Fill,
  type OrderAck,
  type OrderRequest,
  type Unsubscribe,
} from './adapter.ts';

export interface SimAdapterOptions {
  /** Commands + state reads. */
  readonly valkey: Redis;
  /** Dedicated subscriber connection for results. */
  readonly subscriber: Redis;
  readonly timeoutMs?: number;
}

/** Step 1 adapter: our own engine via the Valkey input stream and results channel. */
export class SimAdapter implements ExecutionAdapter {
  private readonly valkey: Redis;
  private readonly sub: Redis;
  private readonly timeoutMs: number;
  private readonly pending = new Map<string, (r: OrderResult) => void>();
  private readonly fillListeners = new Set<(f: Fill) => void>();
  private ready: Promise<unknown> | undefined;

  constructor(o: SimAdapterOptions) {
    this.valkey = o.valkey;
    this.sub = o.subscriber;
    this.timeoutMs = o.timeoutMs ?? 5000;
    this.sub.on('message', (channel: string, msg: string) => {
      if (channel !== CHANNELS.results) return;
      const parsed = orderResultSchema.safeParse(JSON.parse(msg));
      if (!parsed.success) return;
      const r = parsed.data;
      this.pending.get(r.requestId)?.(r);
      if (r.status === 'filled' && !r.duplicate) for (const l of this.fillListeners) l(r);
    });
  }

  private subscribed(): Promise<unknown> {
    this.ready ??= this.sub.subscribe(CHANNELS.results);
    return this.ready;
  }

  async placeOrder(o: OrderRequest): Promise<OrderAck> {
    const snap = await this.valkey.get(KEYS.market(o.market));
    if (snap === null) throw new ExecutionError('unknown-market', `no market ${o.market}`);
    const market = marketSnapshotSchema.parse(JSON.parse(snap));
    let qty: bigint;
    try {
      qty = qtyToLots({ tickSize: market.tickSize, lotSize: market.lotSize }, o.size);
    } catch {
      throw new ExecutionError(
        'invalid-size',
        `size must be a positive multiple of ${market.lotSize}`,
      );
    }
    if (qty <= 0n) throw new ExecutionError('invalid-size', 'size must be positive');
    let limitPrice: bigint | undefined;
    if (o.type === 'limit') {
      try {
        limitPrice = priceToTicks(
          { tickSize: market.tickSize, lotSize: market.lotSize },
          o.limitPrice ?? '',
        );
      } catch {
        throw new ExecutionError(
          'invalid-price',
          `limit price must be a multiple of ${market.tickSize}`,
        );
      }
      if (limitPrice <= 0n)
        throw new ExecutionError('invalid-price', 'limit price must be positive');
    }
    return this.submit((requestId) => ({
      type: 'PlaceOrder',
      requestId,
      idempotencyKey: o.idempotencyKey,
      account: o.account,
      market: o.market,
      side: o.side,
      qty,
      reduceOnly: o.reduceOnly,
      ...(limitPrice === undefined ? {} : { limitPrice }),
    }));
  }

  closePosition(account: string, market: string, idempotencyKey: string): Promise<OrderAck> {
    return this.submit((requestId) => ({
      type: 'ClosePosition',
      requestId,
      idempotencyKey,
      account,
      market,
    }));
  }

  cancelOrder(account: string, orderId: string): Promise<OrderAck> {
    return this.submit((requestId) => ({ type: 'CancelOrder', requestId, account, orderId }));
  }

  streamFills(cb: (f: Fill) => void): Unsubscribe {
    void this.subscribed();
    this.fillListeners.add(cb);
    return () => this.fillListeners.delete(cb);
  }

  async account(account: string): Promise<AccountSnapshot | undefined> {
    const raw = await this.valkey.get(KEYS.account(account));
    return raw === null ? undefined : accountSnapshotSchema.parse(JSON.parse(raw));
  }

  async positions(account: string): Promise<PositionView[]> {
    return (await this.account(account))?.positions ?? [];
  }

  private async submit(build: (requestId: string) => Record<string, unknown>): Promise<OrderAck> {
    await this.subscribed();
    const requestId = randomUUID();
    const result = new Promise<OrderResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new ExecutionError('timeout', 'engine did not answer in time'));
      }, this.timeoutMs);
      this.pending.set(requestId, (r) => {
        clearTimeout(timer);
        this.pending.delete(requestId);
        resolve(r);
      });
    });
    await this.valkey.xadd(
      STREAMS.engineInput,
      'MAXLEN',
      '~',
      String(ENGINE_STREAM_MAXLEN),
      '*',
      'input',
      encodeEngineCommand(build(requestId)),
    );
    return result;
  }
}
