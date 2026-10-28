import type { Address } from 'viem';
import { createSiweMessage } from 'viem/siwe';

export interface NonceResponse {
  readonly nonce: string;
  readonly domain: string;
  readonly chainId: number;
}

/** The EIP-4361 message our API verifies (M6-01): bound to this origin, chain and nonce. */
export function signInMessage(n: NonceResponse, address: Address, origin: string, now: Date) {
  return createSiweMessage({
    domain: n.domain,
    address,
    statement: 'Sign in to EuroEdge testnet. Play money only; this costs nothing.',
    uri: origin,
    version: '1',
    chainId: n.chainId,
    nonce: n.nonce,
    issuedAt: now,
  });
}
