import { describe, expect, it } from 'vitest';
import { usdc } from '@euroedge/fixed';
import type { Redis } from '@euroedge/service-kit';
import { KEYS, STREAMS } from '@euroedge/shared';
import type { EngineInput } from '../src/core/events.ts';
import { publishBatch } from '../src/publisher.ts';
import { Harness, USDC } from './fixtures.ts';

const W = '0x00000000000000000000000000000000000a11ce';

/** Records every pipeline call; enough of the ioredis surface for the publisher. */
function fakeValkey() {
  const calls: unknown[][] = [];
  const pipe: Record<string, unknown> = {};
  for (const m of ['set', 'publish', 'sadd', 'srem', 'xadd'])
    pipe[m] = (...args: unknown[]) => {
      calls.push([m, ...args]);
      return pipe;
    };
  pipe['exec'] = () => Promise.resolve([]);
  return { valkey: { pipeline: () => pipe } as unknown as Redis, calls };
}

async function publish(h: Harness, input: EngineInput) {
  const out = h.run(input);
  const { valkey, calls } = fakeValkey();
  await publishBatch(valkey, h.state, {
    events: [],
    skipped: [],
    outputs: out.map((output) => ({ seq: h.state.seq, output })),
  });
  return calls;
}

describe('withdrawal publishing (M5-08/10)', () => {
  it('writes the record, the pending sets and a stream entry on reserve; clears pending on settle', async () => {
    const h = Harness.booted();
    h.run({ type: 'DevDeposit', account: W, amount: usdc(1_000n * USDC) });
    const id = `${W}:w1`;
    const reserved = await publish(h, {
      type: 'RequestWithdrawal',
      requestId: 'w1',
      account: W,
      amount: usdc(100n * USDC),
    });
    const record = reserved.find((c) => c[0] === 'set' && c[1] === KEYS.withdrawal(id));
    expect(JSON.parse(record?.[2] as string)).toMatchObject({
      id,
      account: W,
      amount: '100000000',
      nonce: '0',
      status: 'pending',
    });
    expect(reserved).toContainEqual(['sadd', KEYS.pendingWithdrawals, id]);
    expect(reserved).toContainEqual(['sadd', KEYS.accountWithdrawals(W), id]);
    expect(
      reserved.some((c) => c[0] === 'xadd' && c[1] === STREAMS.withdrawals && c.includes(id)),
    ).toBe(true);

    const settled = await publish(h, {
      type: 'VaultWithdrawn',
      account: W,
      amount: usdc(100n * USDC),
      nonce: 0n,
      txHash: `0x${'01'.repeat(32)}`,
      logIndex: 0,
    });
    expect(settled).toContainEqual(['srem', KEYS.pendingWithdrawals, id]);
    const after = settled.find((c) => c[0] === 'set' && c[1] === KEYS.withdrawal(id));
    expect(JSON.parse(after?.[2] as string)).toMatchObject({ status: 'executed' });
  });
});
