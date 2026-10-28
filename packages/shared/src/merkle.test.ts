import { describe, expect, it } from 'vitest';
import { balanceTree, verifyProof, type BalanceLeaf } from './merkle.ts';

const addr = (n: number) => `0x${n.toString(16).padStart(40, '0')}` as const;

describe('balance Merkle tree (M5-12)', () => {
  it.each([1, 2, 3, 7, 64])('every leaf proves against the root (%i leaves)', (n) => {
    const leaves: BalanceLeaf[] = Array.from({ length: n }, (_, i) => [
      addr(i + 1),
      BigInt(i * 1_000_000),
    ]);
    const t = balanceTree(leaves);
    for (const l of leaves) expect(verifyProof(t.root, l, t.proof(l) ?? [])).toBe(true);
    expect(verifyProof(t.root, [addr(1), 1n], t.proof(leaves[0] as BalanceLeaf) ?? [])).toBe(false);
  });

  it('does not depend on input order, and has no proof for an unknown leaf', () => {
    const leaves: BalanceLeaf[] = [
      [addr(1), 5n],
      [addr(2), 6n],
      [addr(3), 7n],
    ];
    expect(balanceTree(leaves).root).toBe(balanceTree([...leaves].reverse()).root);
    expect(balanceTree(leaves).proof([addr(9), 1n])).toBeUndefined();
  });

  /** Pinned vector, verified on-chain by contracts/test/BalanceRoot.t.sol (cross-language). */
  it('matches the Solidity vector', () => {
    const leaves: BalanceLeaf[] = [
      [addr(0xa11ce), 1_000_000_000n],
      [addr(0xb0b), 250_000_000n],
      [addr(0xca201), 42n],
    ];
    const t = balanceTree(leaves);
    expect({ root: t.root, proof: t.proof(leaves[0] as BalanceLeaf) }).toMatchSnapshot();
  });
});
