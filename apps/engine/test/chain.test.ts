import { describe, expect, it } from 'vitest';
import { usdc } from '@euroedge/fixed';
import { userAccount } from '@euroedge/ledger';
import type { EngineInput } from '../src/core/events.ts';
import { Harness, USDC } from './fixtures.ts';

const W = '0x00000000000000000000000000000000000a11ce';
const tx = (n: number) => `0x${n.toString(16).padStart(64, '0')}`;
const deposit = (n: number, amount: bigint): EngineInput => ({
  type: 'ChainDeposit',
  account: W,
  amount: usdc(amount),
  txHash: tx(n),
  logIndex: 0,
});
const cash = (h: Harness) => h.state.ledger.balance(userAccount(W)) as bigint;

describe('chain inputs from the indexer (M5-09)', () => {
  it('credits a Vault deposit exactly once per log', () => {
    const h = Harness.booted();
    h.run(deposit(1, 500n * USDC));
    expect(cash(h)).toBe(500n * USDC);
    expect(h.run(deposit(1, 500n * USDC))[0]).toMatchObject({ reason: 'log already applied' });
    h.run({ ...deposit(1, 1n), logIndex: 1 } as EngineInput); // same tx, next log
    expect(cash(h)).toBe(500n * USDC + 1n);
  });

  it('refuses deposits before genesis', () => {
    const h = new Harness();
    expect(h.run(deposit(1, 1n))[0]).toMatchObject({ reason: 'before genesis' });
  });

  it('settles the pending withdrawal by nonce and checks it matches the signature', () => {
    const h = Harness.booted();
    h.run(deposit(1, 1_000n * USDC));
    h.run({ type: 'RequestWithdrawal', requestId: 'w1', account: W, amount: usdc(400n * USDC) });
    const wrong = h.run({
      type: 'VaultWithdrawn',
      account: W,
      amount: usdc(401n * USDC),
      nonce: 0n,
      txHash: tx(9),
      logIndex: 0,
    });
    expect(wrong[0]).toMatchObject({ type: 'InputIgnored' });
    expect(h.state.withdrawals.get(`${W}:w1`)?.status).toBe('pending');
    const ok = h.run({
      type: 'VaultWithdrawn',
      account: W,
      amount: usdc(400n * USDC),
      nonce: 0n,
      txHash: tx(10),
      logIndex: 0,
    });
    expect(ok[0]).toMatchObject({ type: 'WithdrawalSettled', outcome: 'executed' });
    expect(h.state.netDeposits).toBeGreaterThan(0n);
  });
});
