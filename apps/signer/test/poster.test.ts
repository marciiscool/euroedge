import { describe, expect, it } from 'vitest';
import { balanceTree, verifyProof, type BalanceSnapshot, type PostedRoot } from '@euroedge/shared';
import { leavesOf, postRoot, type RootChain, type RootStore } from '../src/poster.ts';

const snap: BalanceSnapshot = {
  hour: '498000',
  seq: '1234',
  leaves: [
    ['0x00000000000000000000000000000000000000aa', '7000000'],
    ['0x00000000000000000000000000000000000000bb', '5000000'],
  ],
};

function setup(already = false) {
  const posted = new Map<string, PostedRoot>();
  const calls: unknown[][] = [];
  const store: RootStore = {
    snapshot: (h) => Promise.resolve(h === snap.hour ? snap : undefined),
    posted: (h) => Promise.resolve(posted.has(h)),
    savePosted: (p) => Promise.resolve(void posted.set(p.hour, p)),
  };
  const chain: RootChain = {
    post: (...args) => {
      calls.push(args);
      return Promise.resolve(already ? 'already-posted' : (`0x${'cd'.repeat(32)}` as const));
    },
  };
  return { store, chain, posted, calls };
}

describe('root poster (M5-12)', () => {
  it('posts the snapshot root once with its seq; proofs verify against it', async () => {
    const { store, chain, posted, calls } = setup();
    expect(await postRoot(store, chain, snap.hour)).toBe('posted');
    expect(await postRoot(store, chain, snap.hour)).toBe('skipped');
    expect(calls).toHaveLength(1);
    const root = posted.get(snap.hour)?.root as `0x${string}`;
    expect(calls[0]).toEqual([498_000n, root, 1234n]);
    const leaves = leavesOf(snap);
    const tree = balanceTree(leaves);
    expect(
      verifyProof(
        root,
        leaves[1] as (typeof leaves)[number],
        tree.proof(leaves[1] as (typeof leaves)[number]) ?? [],
      ),
    ).toBe(true);
  });

  it('treats an hour the contract already has as done, and skips unknown or empty hours', async () => {
    const { store, chain, posted } = setup(true);
    expect(await postRoot(store, chain, snap.hour)).toBe('skipped');
    expect(posted.size).toBe(0);
    expect(await postRoot(store, chain, '1')).toBe('skipped');
  });
});
