import { concat, encodeAbiParameters, keccak256, type Hex } from 'viem';

/**
 * OpenZeppelin "standard" Merkle tree over (address, uint256) leaves (M5-12), identical to
 * what `BalanceRoot.verify` / `MerkleProof.verify` check: leaf = keccak(keccak(abi.encode(a, b))),
 * pairs hashed sorted. Leaves are sorted by hash, so the root does not depend on input order.
 */
export type BalanceLeaf = readonly [account: `0x${string}`, balance: bigint];

export const leafHash = ([account, balance]: BalanceLeaf): Hex =>
  keccak256(
    keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [account, balance])),
  );

const hashPair = (a: Hex, b: Hex): Hex =>
  keccak256(a.toLowerCase() < b.toLowerCase() ? concat([a, b]) : concat([b, a]));

export interface BalanceTree {
  readonly root: Hex;
  proof(leaf: BalanceLeaf): Hex[] | undefined;
}

export function balanceTree(leaves: readonly BalanceLeaf[]): BalanceTree {
  if (leaves.length === 0) throw new Error('empty tree');
  const hashes = leaves.map(leafHash).sort((x, y) => (x.toLowerCase() < y.toLowerCase() ? -1 : 1));
  const tree: Hex[] = new Array<Hex>(2 * hashes.length - 1);
  hashes.forEach((h, i) => (tree[tree.length - 1 - i] = h));
  for (let i = tree.length - 1 - hashes.length; i >= 0; i--) {
    tree[i] = hashPair(tree[2 * i + 1] as Hex, tree[2 * i + 2] as Hex);
  }
  return {
    root: tree[0] as Hex,
    proof(leaf) {
      let i = tree.indexOf(leafHash(leaf));
      if (i < 0) return undefined;
      const proof: Hex[] = [];
      while (i > 0) {
        proof.push(tree[i % 2 === 1 ? i + 1 : i - 1] as Hex);
        i = Math.floor((i - 1) / 2);
      }
      return proof;
    },
  };
}

/** Recomputes the root from a leaf and its proof (what the contract does). */
export function verifyProof(root: Hex, leaf: BalanceLeaf, proof: readonly Hex[]): boolean {
  return (
    proof.reduce<Hex>((h, p) => hashPair(h, p), leafHash(leaf)).toLowerCase() === root.toLowerCase()
  );
}
