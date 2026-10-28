import type { WithdrawalRecord } from '@euroedge/shared';
import type { EngineSink } from './indexer.ts';

export interface ExpiryChain {
  /** The safe block's number and timestamp (seconds). */
  safeHead(): Promise<{ number: bigint; timestamp: bigint }>;
  /** Vault.nonceUsed(nonce) as of `block`. */
  nonceUsed(nonce: bigint, block: bigint): Promise<boolean>;
}

/**
 * Withdrawal expiry (M5-10). A pending withdrawal is expired once the safe block is past its
 * deadline and its nonce is still unused there: every block that could have executed it is
 * then final. The engine re-credits it (and ignores repeats); executed ones settle through
 * their Withdrawn log instead.
 */
export async function checkExpiries(
  pending: readonly WithdrawalRecord[],
  chain: ExpiryChain,
  sink: EngineSink,
): Promise<number> {
  const live = pending.filter((w) => w.status === 'pending');
  if (live.length === 0) return 0;
  const head = await chain.safeHead();
  let n = 0;
  for (const w of live) {
    const deadlineSec = BigInt(w.deadlineMs) / 1000n;
    if (head.timestamp <= deadlineSec) continue;
    if (await chain.nonceUsed(BigInt(w.nonce), head.number)) continue;
    await sink({ type: 'WithdrawalExpired', withdrawalId: w.id });
    n += 1;
  }
  return n;
}
