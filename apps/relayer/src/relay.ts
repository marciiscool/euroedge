import type { Address, Hex } from 'viem';

/** A user-signed request the relayer submits and pays gas for (M5-11). */
export interface RelayRequest {
  readonly user: Address;
  /** µUSDC. */
  readonly amount: bigint;
  /** Unix seconds. */
  readonly deadline: bigint;
  readonly signature: Hex;
}

export type RelayKind = 'claim' | 'deposit';

export interface RelayChain {
  /** Simulates first and returns the revert reason instead of paying for a failing tx. */
  simulate(kind: RelayKind, r: RelayRequest): Promise<{ ok: true } | { ok: false; reason: string }>;
  send(kind: RelayKind, r: RelayRequest): Promise<Hex>;
}

export interface RateLimiter {
  /** Counts a hit; false once `key` exceeded `max` within `windowSec`. */
  hit(key: string, max: number, windowSec: number): Promise<boolean>;
}

export interface RelayLimits {
  readonly perWallet: number;
  readonly perIp: number;
  readonly windowSec: number;
}

/** PROPOSED limits: 5 relays per wallet and 20 per IP per hour. */
export const DEFAULT_LIMITS: RelayLimits = { perWallet: 5, perIp: 20, windowSec: 3_600 };

export type RelayResult =
  | { readonly status: 'sent'; readonly txHash: Hex }
  | { readonly status: 'rate-limited'; readonly scope: 'wallet' | 'ip' }
  | { readonly status: 'rejected'; readonly reason: string };

export async function relay(
  chain: RelayChain,
  limiter: RateLimiter,
  limits: RelayLimits,
  kind: RelayKind,
  r: RelayRequest,
  ip: string,
): Promise<RelayResult> {
  if (!(await limiter.hit(`relay:ip:${ip}`, limits.perIp, limits.windowSec)))
    return { status: 'rate-limited', scope: 'ip' };
  if (
    !(await limiter.hit(`relay:wallet:${r.user.toLowerCase()}`, limits.perWallet, limits.windowSec))
  )
    return { status: 'rate-limited', scope: 'wallet' };
  const sim = await chain.simulate(kind, r);
  if (!sim.ok) return { status: 'rejected', reason: sim.reason };
  return { status: 'sent', txHash: await chain.send(kind, r) };
}
