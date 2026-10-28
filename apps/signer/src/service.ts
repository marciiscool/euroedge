import { getAddress } from 'viem';
import {
  withdrawalRecordSchema,
  type WithdrawalAuth,
  type WithdrawalRecord,
} from '@euroedge/shared';
import type { WithdrawalSigner } from './signer.ts';

/** Where reservations come from and authorisations go (Valkey in production). */
export interface SignerStore {
  record(id: string): Promise<WithdrawalRecord | undefined>;
  hasAuth(id: string): Promise<boolean>;
  saveAuth(auth: WithdrawalAuth): Promise<void>;
}

/**
 * Signs each pending reservation once. The chain deadline is ⌊deadlineMs / 1000⌋, so an
 * authorisation can never be executable after the engine considers it expired (M4-18/M5-10).
 */
export async function signReservation(
  store: SignerStore,
  signer: WithdrawalSigner,
  chain: { chainId: number; vault: string },
  id: string,
): Promise<'signed' | 'skipped'> {
  const r = await store.record(id);
  if (r === undefined || r.status !== 'pending' || (await store.hasAuth(id))) return 'skipped';
  const deadline = BigInt(r.deadlineMs) / 1000n;
  const signature = await signer.sign({
    user: getAddress(r.account),
    amount: BigInt(r.amount),
    nonce: BigInt(r.nonce),
    deadline,
  });
  await store.saveAuth({
    id,
    vault: chain.vault,
    chainId: chain.chainId,
    deadlineSec: deadline.toString(),
    signature,
  });
  return 'signed';
}

export const parseRecord = (raw: string | null): WithdrawalRecord | undefined =>
  raw === null ? undefined : withdrawalRecordSchema.parse(JSON.parse(raw));
