import { describe, expect, it } from 'vitest';
import { usdc } from '@euroedge/fixed';
import { SYSTEM, userAccount } from '@euroedge/ledger';
import type { EngineInput } from '../src/core/events.ts';
import { assertInvariants } from '../src/core/invariants.ts';
import type { EngineOutput } from '../src/core/outputs.ts';
import { WITHDRAWAL_TTL_MS, withdrawable } from '../src/core/withdrawals.ts';
import { data, Harness, order, USDC } from './fixtures.ts';

const ALICE = '0x00000000000000000000000000000000000a11ce';

function harness(): Harness {
  const h = Harness.booted();
  h.run({ type: 'DevDeposit', account: ALICE, amount: usdc(10_000n * USDC) });
  return h;
}

const request = (requestId: string, amount: bigint, account = ALICE): EngineInput => ({
  type: 'RequestWithdrawal',
  requestId,
  account,
  amount: usdc(amount),
});
const find = <T extends EngineOutput['type']>(out: EngineOutput[], type: T) =>
  out.find((o): o is Extract<EngineOutput, { type: T }> => o.type === type);
const cash = (h: Harness) => h.state.ledger.balance(userAccount(ALICE)) as bigint;

describe('withdrawal reservation (M4-18)', () => {
  it('reserves into vault-pending with a nonce and deadline; executed leaves the system', () => {
    const h = harness();
    const out = h.run(request('w1', 4_000n * USDC));
    const r = find(out, 'WithdrawalReserved');
    expect(r).toMatchObject({ withdrawalId: `${ALICE}:w1`, nonce: 0n, duplicate: false });
    expect(r?.deadline).toBe(h.state.ts + WITHDRAWAL_TTL_MS);
    expect(cash(h)).toBe(6_000n * USDC);
    expect(h.state.ledger.balance(SYSTEM.vaultPending)).toBe(4_000n * USDC);

    const before = h.state.netDeposits;
    const done = h.run({ type: 'WithdrawalExecuted', withdrawalId: `${ALICE}:w1` });
    expect(find(done, 'WithdrawalSettled')).toMatchObject({ outcome: 'executed' });
    expect(h.state.ledger.balance(SYSTEM.vaultPending)).toBe(0n);
    expect(h.state.netDeposits).toBe(before - 4_000n * USDC);
    expect(cash(h)).toBe(6_000n * USDC);
  });

  it('re-credits only once the deadline has passed', () => {
    const h = harness();
    h.run(request('w1', 1_000n * USDC));
    const id = `${ALICE}:w1`;
    const early = h.run({ type: 'WithdrawalExpired', withdrawalId: id });
    expect(find(early, 'InputIgnored')?.reason).toBe('deadline not passed');
    h.skip(WITHDRAWAL_TTL_MS);
    expect(
      find(h.run({ type: 'WithdrawalExpired', withdrawalId: id }), 'WithdrawalSettled'),
    ).toMatchObject({
      outcome: 'expired',
    });
    expect(cash(h)).toBe(10_000n * USDC);
    // Settled once: neither outcome applies again.
    expect(
      find(h.run({ type: 'WithdrawalExecuted', withdrawalId: id }), 'InputIgnored')?.reason,
    ).toBe('withdrawal already expired');
  });

  it('is idempotent per request id and numbers nonces in order', () => {
    const h = harness();
    h.run(request('w1', 100n * USDC));
    const again = find(h.run(request('w1', 100n * USDC)), 'WithdrawalReserved');
    expect(again).toMatchObject({ duplicate: true, nonce: 0n });
    expect(cash(h)).toBe(9_900n * USDC);
    expect(find(h.run(request('w2', 100n * USDC)), 'WithdrawalReserved')?.nonce).toBe(1n);
  });

  it('keeps initial margin: only free collateral can leave', () => {
    const h = harness();
    // 10 shares at ≈ 700.35 = 7 003.50 notional, IM at 5× = 1 400.70 (+ taker fee 3.50).
    h.run(order(ALICE, 'buy', 1_000n));
    const free = withdrawable(h.state, ALICE) as bigint;
    expect(free).toBeLessThan(8_600n * USDC);
    expect(find(h.run(request('big', free + 1n)), 'WithdrawalRejected')?.reason).toBe(
      'insufficient-withdrawable',
    );
    expect(find(h.run(request('ok', free)), 'WithdrawalReserved')).toBeDefined();
    // At exactly IM the account is still above maintenance: no liquidation.
    h.run(data(70_000n));
    expect(h.state.accounts.get(ALICE)?.positions.get('ASML-PERP')?.lots).toBe(1_000n);
  });

  it.each([
    ['invalid-amount', request('a', 0n)],
    ['not-a-wallet', request('b', USDC, 'alice')],
    ['unknown-account', request('c', USDC, '0x00000000000000000000000000000000000b0b00')],
  ] as const)('rejects %s', (reason, input) => {
    const h = harness();
    expect(find(h.run(input), 'WithdrawalRejected')?.reason).toBe(reason);
  });

  it('ignores settlements for unknown withdrawals', () => {
    const h = harness();
    expect(
      find(h.run({ type: 'WithdrawalExecuted', withdrawalId: 'nope' }), 'InputIgnored')?.reason,
    ).toBe('unknown withdrawal');
  });

  it('counts pending withdrawals as vault claims (Invariants 7 and 10)', () => {
    const h = harness();
    h.run(request('w1', 2_000n * USDC));
    expect(() => assertInvariants(h.state)).not.toThrow();
    // Tampering with vault-pending outside a withdrawal breaks Invariant 10.
    h.state.ledger.post([
      { from: userAccount(ALICE), to: SYSTEM.vaultPending, amount: usdc(1n), reason: 'withdrawal' },
    ]);
    expect(() => assertInvariants(h.state)).toThrow(/invariant 10/);
  });
});
