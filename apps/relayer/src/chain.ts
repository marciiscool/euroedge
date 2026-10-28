import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  formatEther,
  http,
  type Address,
  type Hex,
} from 'viem';
import { nonceManager, privateKeyToAccount } from 'viem/accounts';
import { TOKEN_ABI, VAULT_ABI } from './abi.ts';
import type { RelayChain, RelayKind, RelayRequest } from './relay.ts';

export interface ChainConfig {
  readonly rpcUrl: string;
  readonly privateKey: Hex;
  readonly token: Address;
  readonly vault: Address;
}

/** viem-backed relay: one relayer key, local nonce manager so concurrent sends do not collide. */
export function viemRelayChain(c: ChainConfig) {
  const account = privateKeyToAccount(c.privateKey, { nonceManager });
  const transport = http(c.rpcUrl);
  const pub = createPublicClient({ transport });
  const wallet = createWalletClient({ account, transport });
  const args = (r: RelayRequest) => [r.user, r.amount, r.deadline, r.signature] as const;
  const claim = (r: RelayRequest) =>
    ({
      address: c.token,
      abi: TOKEN_ABI,
      functionName: 'claimFor',
      args: args(r),
      account,
    }) as const;
  const deposit = (r: RelayRequest) =>
    ({
      address: c.vault,
      abi: VAULT_ABI,
      functionName: 'depositWithPermit',
      args: args(r),
      account,
    }) as const;
  const withdraw = (r: RelayRequest) =>
    ({
      address: c.vault,
      abi: VAULT_ABI,
      functionName: 'withdraw',
      args: [r.user, r.amount, r.nonce ?? 0n, r.deadline, r.signature],
      account,
    }) as const;
  const simulateCall = (kind: RelayKind, r: RelayRequest) =>
    kind === 'claim'
      ? pub.simulateContract(claim(r))
      : kind === 'deposit'
        ? pub.simulateContract(deposit(r))
        : pub.simulateContract(withdraw(r));

  const chain: RelayChain = {
    async simulate(kind, r) {
      try {
        await simulateCall(kind, r);
        return { ok: true };
      } catch (err) {
        if (err instanceof BaseError) {
          const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
          if (revert instanceof ContractFunctionRevertedError)
            return { ok: false, reason: revert.data?.errorName ?? revert.shortMessage };
          return { ok: false, reason: err.shortMessage };
        }
        throw err;
      }
    },
    async send(kind, r) {
      // simulateContract returns the request writeContract signs and sends.
      if (kind === 'claim') {
        const { request } = await pub.simulateContract(claim(r));
        return wallet.writeContract(request);
      }
      if (kind === 'deposit') {
        const { request } = await pub.simulateContract(deposit(r));
        return wallet.writeContract(request);
      }
      const { request } = await pub.simulateContract(withdraw(r));
      return wallet.writeContract(request);
    },
  };
  return {
    chain,
    address: account.address,
    /** Relayer ETH balance, for the low-balance alert. */
    balance: async () => formatEther(await pub.getBalance({ address: account.address })),
  };
}
