import { describe, expect, it } from 'vitest';
import { recoverTypedDataAddress } from 'viem';
import type { WithdrawalAuth, WithdrawalRecord } from '@euroedge/shared';
import { signReservation, type SignerStore } from '../src/service.ts';
import { localSigner, vaultDomain, WITHDRAWAL_TYPES } from '../src/signer.ts';

const KEY = `0x${'59'.repeat(32)}` as const;
const VAULT = '0x00000000000000000000000000000000000000aa' as const;
const USER = '0x00000000000000000000000000000000000a11ce';

function store(record: WithdrawalRecord) {
  const auths = new Map<string, WithdrawalAuth>();
  const s: SignerStore = {
    record: (id) => Promise.resolve(id === record.id ? record : undefined),
    hasAuth: (id) => Promise.resolve(auths.has(id)),
    saveAuth: (a) => Promise.resolve(void auths.set(a.id, a)),
  };
  return { s, auths };
}

const pending: WithdrawalRecord = {
  id: `${USER}:w1`,
  account: USER,
  amount: '2500000000',
  nonce: '7',
  deadlineMs: '1900000000999',
  status: 'pending',
};

describe('engine signer (M5-08)', () => {
  it('signs a pending reservation once, with the deadline floored to seconds', async () => {
    const signer = localSigner(KEY, 84532, VAULT);
    const { s, auths } = store(pending);
    expect(await signReservation(s, signer, { chainId: 84532, vault: VAULT }, pending.id)).toBe(
      'signed',
    );
    expect(await signReservation(s, signer, { chainId: 84532, vault: VAULT }, pending.id)).toBe(
      'skipped',
    );
    const a = auths.get(pending.id);
    expect(a?.deadlineSec).toBe('1900000000');
    const recovered = await recoverTypedDataAddress({
      domain: vaultDomain(84532, VAULT),
      types: WITHDRAWAL_TYPES,
      primaryType: 'Withdrawal',
      message: { user: USER, amount: 2_500_000_000n, nonce: 7n, deadline: 1_900_000_000n },
      signature: a?.signature as `0x${string}`,
    });
    expect(recovered).toBe(signer.address);
  });

  it('never signs a settled or unknown withdrawal', async () => {
    const signer = localSigner(KEY, 84532, VAULT);
    const { s, auths } = store({ ...pending, status: 'expired' });
    expect(await signReservation(s, signer, { chainId: 84532, vault: VAULT }, pending.id)).toBe(
      'skipped',
    );
    expect(await signReservation(s, signer, { chainId: 84532, vault: VAULT }, 'nope')).toBe(
      'skipped',
    );
    expect(auths.size).toBe(0);
  });
});
