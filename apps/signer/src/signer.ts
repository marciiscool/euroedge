import type { Address, Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

/** What the Vault verifies (contracts/src/Vault.sol, WITHDRAWAL_TYPEHASH). */
export interface WithdrawalMessage {
  readonly user: Address;
  /** µUSDC. */
  readonly amount: bigint;
  readonly nonce: bigint;
  /** Unix seconds. */
  readonly deadline: bigint;
}

/**
 * The engine signer (M5-08). Separate key from deployer and relayer (brief §12); a KMS-backed
 * implementation only has to provide these two members.
 */
export interface WithdrawalSigner {
  readonly address: Address;
  sign(m: WithdrawalMessage): Promise<Hex>;
}

export const WITHDRAWAL_TYPES = {
  Withdrawal: [
    { name: 'user', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const;

export function vaultDomain(chainId: number, vault: Address) {
  return { name: 'EuroEdge Vault', version: '1', chainId, verifyingContract: vault } as const;
}

/** Local private key (dev, CI, testnet); swap for KMS outside local dev. */
export function localSigner(privateKey: Hex, chainId: number, vault: Address): WithdrawalSigner {
  const account = privateKeyToAccount(privateKey);
  return {
    address: account.address,
    sign: (m) =>
      account.signTypedData({
        domain: vaultDomain(chainId, vault),
        types: WITHDRAWAL_TYPES,
        primaryType: 'Withdrawal',
        message: m,
      }),
  };
}
