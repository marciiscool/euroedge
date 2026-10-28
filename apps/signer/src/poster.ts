import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  balanceTree,
  type BalanceLeaf,
  type BalanceSnapshot,
  type PostedRoot,
} from '@euroedge/shared';

export interface RootStore {
  snapshot(hour: string): Promise<BalanceSnapshot | undefined>;
  posted(hour: string): Promise<boolean>;
  savePosted(p: PostedRoot): Promise<void>;
}

export interface RootChain {
  /** Posts the root; 'already-posted' if the contract has this hour (or a later one). */
  post(hour: bigint, root: Hex, seq: bigint): Promise<Hex | 'already-posted'>;
}

export const leavesOf = (s: BalanceSnapshot): BalanceLeaf[] =>
  s.leaves.map(([a, b]) => [a as `0x${string}`, BigInt(b)] as const);

/** Root poster (M5-12): one root per snapshot hour, idempotent across restarts. */
export async function postRoot(
  store: RootStore,
  chain: RootChain,
  hour: string,
): Promise<'posted' | 'skipped' | 'empty'> {
  if (await store.posted(hour)) return 'skipped';
  const snap = await store.snapshot(hour);
  if (snap === undefined) return 'skipped';
  if (snap.leaves.length === 0) return 'empty';
  const { root } = balanceTree(leavesOf(snap));
  const tx = await chain.post(BigInt(hour), root, BigInt(snap.seq));
  if (tx === 'already-posted') return 'skipped';
  await store.savePosted({ hour, root, txHash: tx });
  return 'posted';
}

const BALANCE_ROOT_ABI = parseAbi([
  'function post(uint64 hour, bytes32 root, uint64 seq)',
  'error HourNotIncreasing(uint64 hour, uint64 latest)',
  'error EmptyRoot()',
]);

export function viemRootChain(rpcUrl: string, privateKey: Hex, balanceRoot: Address): RootChain {
  const account = privateKeyToAccount(privateKey);
  const transport = http(rpcUrl);
  const pub = createPublicClient({ transport });
  const wallet = createWalletClient({ account, transport });
  return {
    async post(hour, root, seq) {
      try {
        const { request } = await pub.simulateContract({
          address: balanceRoot,
          abi: BALANCE_ROOT_ABI,
          functionName: 'post',
          args: [hour, root, seq],
          account,
        });
        const hash = await wallet.writeContract(request);
        await pub.waitForTransactionReceipt({ hash });
        return hash;
      } catch (err) {
        const revert =
          err instanceof BaseError
            ? err.walk((e) => e instanceof ContractFunctionRevertedError)
            : undefined;
        if (
          revert instanceof ContractFunctionRevertedError &&
          revert.data?.errorName === 'HourNotIncreasing'
        )
          return 'already-posted';
        throw err;
      }
    },
  };
}
