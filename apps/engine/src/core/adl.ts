import type { EngineState } from './state.ts';
import { SYSTEM } from '@euroedge/ledger';

/**
 * Who covers a liquidation shortfall (M4-30, review gate: math). The engine asks the policy
 * once per liquidated account; the split must add up to the shortfall exactly.
 */
export interface AdlPolicy {
  readonly name: string;
  cover(
    state: EngineState,
    shortfall: bigint,
  ): { readonly insurance: bigint; readonly house: bigint };
}

/**
 * PROPOSED default: the insurance fund pays as far as its balance goes, the house (the
 * counterparty that took the position at mark) backstops the rest. Without it an exhausted
 * fund would break Invariant 9 and fail-stop the engine; CB7 (ADR-0013) already makes the
 * venue reduce-only well before that. Auto-deleveraging profitable traders is not
 * implemented: with the house as sole counterparty there is no opposing user to deleverage.
 */
export const insuranceThenHouse: AdlPolicy = {
  name: 'insurance-then-house',
  cover(state, shortfall) {
    const fund = state.ledger.balance(SYSTEM.insurance) as bigint;
    const insurance = fund <= 0n ? 0n : fund < shortfall ? fund : shortfall;
    return { insurance, house: shortfall - insurance };
  },
};

export const ADL_POLICY: AdlPolicy = insuranceThenHouse;
