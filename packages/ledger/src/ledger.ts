import { usdc, type Usdc } from '@euroedge/fixed';

/** System accounts (brief §7.3). User accounts are `user:<id>`. */
export const SYSTEM = {
  house: 'house',
  insurance: 'insurance',
  fees: 'fees',
  fundingClearing: 'funding-clearing',
  vaultPending: 'vault-pending',
  /** Contra account for value entering/leaving through the Vault; not part of the internal sum. */
  external: 'external:vault',
} as const;

export const userAccount = (id: string): string => `user:${id}`;

export type PostingReason =
  | 'genesis'
  | 'deposit'
  | 'withdrawal'
  | 'fee'
  | 'realized-pnl'
  | 'funding'
  | 'liquidation-penalty'
  | 'insurance-cover';

/** One balanced transfer: `from` −amount, `to` +amount. */
export interface Posting {
  readonly from: string;
  readonly to: string;
  readonly amount: Usdc;
  readonly reason: PostingReason;
}

/**
 * Double-entry ledger in µUSDC. Every movement is a transfer, so Σ over all accounts
 * (including the external contra account) is always zero. Batches apply atomically.
 */
export class Ledger {
  private readonly balances = new Map<string, bigint>();

  balance(account: string): Usdc {
    return usdc(this.balances.get(account) ?? 0n);
  }

  /** Validates the whole batch first, then applies it — all or nothing. */
  post(postings: readonly Posting[]): void {
    for (const p of postings) {
      if (p.amount <= 0n)
        throw new RangeError(`posting amount must be > 0 (${p.reason}: ${p.amount})`);
      if (p.from === p.to) throw new RangeError(`posting from and to are both ${p.from}`);
    }
    for (const p of postings) {
      this.balances.set(p.from, (this.balances.get(p.from) ?? 0n) - p.amount);
      this.balances.set(p.to, (this.balances.get(p.to) ?? 0n) + p.amount);
    }
  }

  /** Σ of all balances except the external contra account (= net deposits, Invariant 1). */
  internalTotal(): Usdc {
    let total = 0n;
    for (const [account, b] of this.balances) if (account !== SYSTEM.external) total += b;
    return usdc(total);
  }

  /** Value that entered through the Vault net of withdrawals. */
  netExternalInflow(): Usdc {
    return usdc(-(this.balances.get(SYSTEM.external) ?? 0n));
  }

  /** Deterministic snapshot (sorted by account) for hashing and replay comparison. */
  entries(): [string, bigint][] {
    return [...this.balances.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  }
}
