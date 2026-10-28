import { describe, expect, it } from 'vitest';
import type { WithdrawalRecord } from '@euroedge/shared';
import { checkExpiries, type ExpiryChain } from '../src/expiry.ts';

const w = (
  id: string,
  nonce: number,
  deadlineSec: number,
  status: WithdrawalRecord['status'] = 'pending',
): WithdrawalRecord => ({
  id,
  account: '0x00000000000000000000000000000000000a11ce',
  amount: '1',
  nonce: String(nonce),
  deadlineMs: String(deadlineSec * 1000 + 999),
  status,
});

function chain(timestamp: number, used: number[]): ExpiryChain {
  return {
    safeHead: () => Promise.resolve({ number: 100n, timestamp: BigInt(timestamp) }),
    nonceUsed: (nonce) => Promise.resolve(used.includes(Number(nonce))),
  };
}

describe('withdrawal expiry (M5-10)', () => {
  it('re-credits only past the deadline at the safe block and with an unused nonce', async () => {
    const sent: Record<string, unknown>[] = [];
    const n = await checkExpiries(
      [w('a', 1, 1_000), w('b', 2, 1_000), w('c', 3, 2_000), w('d', 4, 500, 'executed')],
      chain(1_001, [2]),
      (i) => Promise.resolve(void sent.push(i)),
    );
    expect(n).toBe(1);
    expect(sent).toEqual([{ type: 'WithdrawalExpired', withdrawalId: 'a' }]);
  });

  it('waits while the safe block is not yet past the deadline', async () => {
    const sent: unknown[] = [];
    expect(
      await checkExpiries([w('a', 1, 1_000)], chain(1_000, []), (i) =>
        Promise.resolve(void sent.push(i)),
      ),
    ).toBe(0);
    expect(sent).toEqual([]);
  });
});
