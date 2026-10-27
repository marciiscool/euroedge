import { ExecutionError, type ExecutionAdapter } from './adapter.ts';

const todo = (what: string) => () =>
  Promise.reject(new ExecutionError('not-supported', `${what}: not implemented`));

/**
 * Step 2: a licensed EU partner's book (FIX/REST). TODO: map OrderRequest to the partner's
 * order API, fills from its drop-copy, positions from its account API; KYC is the partner's.
 */
export const partnerAdapterStub: ExecutionAdapter = {
  placeOrder: todo('PartnerAdapter.placeOrder'),
  closePosition: todo('PartnerAdapter.closePosition'),
  cancelOrder: todo('PartnerAdapter.cancelOrder'),
  streamFills: () => () => undefined,
  positions: todo('PartnerAdapter.positions'),
  account: todo('PartnerAdapter.account'),
};

/** Step 3: our own licensed venue with in-house market making and hedging. TODO. */
export const ownVenueAdapterStub: ExecutionAdapter = {
  placeOrder: todo('OwnVenueAdapter.placeOrder'),
  closePosition: todo('OwnVenueAdapter.closePosition'),
  cancelOrder: todo('OwnVenueAdapter.cancelOrder'),
  streamFills: () => () => undefined,
  positions: todo('OwnVenueAdapter.positions'),
  account: todo('OwnVenueAdapter.account'),
};
