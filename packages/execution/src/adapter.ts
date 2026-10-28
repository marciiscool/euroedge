import type { AccountSnapshot, OrderResult, PositionView } from '@euroedge/shared';

export type Unsubscribe = () => void;

/** Venue-neutral order request (decimal strings; the adapter maps to venue units). */
export interface OrderRequest {
  readonly account: string;
  readonly market: string;
  readonly side: 'buy' | 'sell';
  /** Size in contracts, decimal string (e.g. "1.50"). */
  readonly size: string;
  readonly type: 'market' | 'limit';
  /** Limit price, decimal string (required for limit orders). */
  readonly limitPrice?: string;
  readonly reduceOnly: boolean;
  /** Client-chosen key; a retry with the same key never fills twice. */
  readonly idempotencyKey: string;
}

export type OrderAck = OrderResult;
export type Fill = Extract<OrderResult, { status: 'filled' }>;

/**
 * The only path from API/UI to a venue (brief §7.4). SimAdapter = our engine (step 1);
 * PartnerAdapter (step 2) and OwnVenueAdapter (step 3) implement the same contract.
 */
export interface ExecutionAdapter {
  placeOrder(o: OrderRequest): Promise<OrderAck>;
  closePosition(account: string, market: string, idempotencyKey: string): Promise<OrderAck>;
  /** Cancels a resting order by the idempotency key it was placed with. */
  cancelOrder(account: string, orderId: string): Promise<OrderAck>;
  streamFills(cb: (f: Fill) => void): Unsubscribe;
  positions(account: string): Promise<PositionView[]>;
  account(account: string): Promise<AccountSnapshot | undefined>;
}

export class ExecutionError extends Error {
  readonly code:
    | 'timeout'
    | 'invalid-size'
    | 'invalid-price'
    | 'unknown-market'
    | 'not-supported'
    | 'unavailable';

  constructor(code: ExecutionError['code'], message: string) {
    super(message);
    this.name = 'ExecutionError';
    this.code = code;
  }
}
