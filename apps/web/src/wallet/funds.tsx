'use client';

import { Button } from '@euroedge/ui/components/button';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useId, useState } from 'react';
import { getAddress, parseAbi, type Address } from 'viem';
import { useAccount, useConfig, useReadContracts, useSignTypedData } from 'wagmi';
import { readContract } from 'wagmi/actions';
import { api, ApiError, type ChainInfo, type Withdrawal } from '@/lib/api';
import {
  claimTypedData,
  explorerTx,
  formatUsdc,
  parseUsdc,
  permitTypedData,
  signatureDeadline,
  type TokenChain,
} from './funds-model';

const TOKEN_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function claimable(address) view returns (uint256)',
  'function nonces(address) view returns (uint256)',
]);

type Message = { readonly ok: boolean; readonly text: string; readonly tx?: string | undefined };

/**
 * Wallet & funds (M5): gasless claim and deposit (the wallet signs, the relayer pays gas), and
 * withdrawals (the engine reserves, the engine signer authorises, the relayer submits).
 */
export function Funds({ account }: { account: string }) {
  const [chain, setChain] = useState<ChainInfo | null>(null);
  useEffect(() => {
    api.chain().then(setChain, () => setChain({ enabled: false }));
  }, []);
  const t = useTranslations('Funds');
  if (chain === null) return null;
  if (!chain.enabled) return <p className="text-xs text-muted-foreground">{t('notLive')}</p>;
  return <FundsLive account={getAddress(account)} chain={chain} />;
}

function FundsLive({ account, chain }: { account: Address; chain: TokenChain }) {
  const t = useTranslations('Funds');
  const locale = useLocale();
  const config = useConfig();
  const { address } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState<'claim' | 'deposit' | 'withdraw' | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const inputId = useId();

  const reads = useReadContracts({
    contracts: [
      {
        address: chain.token,
        abi: TOKEN_ABI,
        functionName: 'balanceOf',
        args: [account],
        chainId: chain.chainId,
      },
      {
        address: chain.token,
        abi: TOKEN_ABI,
        functionName: 'claimable',
        args: [account],
        chainId: chain.chainId,
      },
    ],
    query: { refetchInterval: 5_000 },
  });
  const walletBalance = reads.data?.[0]?.result;
  const claimable = reads.data?.[1]?.result;

  const refreshWithdrawals = useCallback(() => {
    api.withdrawals().then(
      (r) => setWithdrawals(r.withdrawals),
      () => undefined,
    );
  }, []);
  useEffect(() => {
    refreshWithdrawals();
    const timer = setInterval(refreshWithdrawals, 5_000);
    return () => clearInterval(timer);
  }, [refreshWithdrawals]);

  // Fresh nonce right before signing: claim and permit share one counter.
  const nonce = () =>
    readContract(config, {
      address: chain.token,
      abi: TOKEN_ABI,
      functionName: 'nonces',
      args: [account],
      chainId: chain.chainId,
    });

  const fail = (err: unknown) =>
    setMessage({ ok: false, text: err instanceof ApiError ? err.message : t('failed') });

  async function claim() {
    const want = parseUsdc(amount) ?? claimable ?? 0n;
    const value = claimable !== undefined && want > claimable ? claimable : want;
    if (value <= 0n) return setMessage({ ok: false, text: t('nothingToClaim') });
    setBusy('claim');
    try {
      const deadline = signatureDeadline(Date.now());
      const signature = await signTypedDataAsync(
        claimTypedData(chain, account, value, await nonce(), deadline),
      );
      const { txHash } = await api.relay('claim', {
        user: account,
        amount: value.toString(),
        deadline: deadline.toString(),
        signature,
      });
      setMessage({
        ok: true,
        text: t('claimed', { amount: formatUsdc(value, locale) }),
        tx: explorerTx(chain.chainId, txHash),
      });
      void reads.refetch();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  }

  async function deposit() {
    const value = parseUsdc(amount);
    if (value === undefined) return setMessage({ ok: false, text: t('enterAmount') });
    if (walletBalance !== undefined && value > walletBalance)
      // An empty wallet with Test USDC left to claim: say what to do, not just "not enough".
      return setMessage({
        ok: false,
        text: walletBalance === 0n && (claimable ?? 0n) > 0n ? t('claimFirst') : t('notEnough'),
      });
    setBusy('deposit');
    try {
      const deadline = signatureDeadline(Date.now());
      const signature = await signTypedDataAsync(
        permitTypedData(chain, account, value, await nonce(), deadline),
      );
      const { txHash } = await api.relay('deposit', {
        user: account,
        amount: value.toString(),
        deadline: deadline.toString(),
        signature,
      });
      setMessage({
        ok: true,
        text: t('deposited', { amount: formatUsdc(value, locale) }),
        tx: explorerTx(chain.chainId, txHash),
      });
      setAmount('');
      void reads.refetch();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  }

  async function withdraw() {
    const value = parseUsdc(amount);
    if (value === undefined) return setMessage({ ok: false, text: t('enterAmount') });
    setBusy('withdraw');
    try {
      const { withdrawalId } = await api.requestWithdrawal(value);
      setMessage({ ok: true, text: t('withdrawRequested') });
      // The engine reserves it, then the engine signer authorises it (a few seconds).
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 1_000));
        const w = (await api.withdrawals()).withdrawals.find((x) => x.id === withdrawalId);
        if (w === undefined || w.authorisation === null) continue;
        const { txHash } = await api.relay('withdraw', {
          user: account,
          amount: w.amount,
          nonce: w.nonce,
          deadline: w.authorisation.deadlineSec,
          signature: w.authorisation.signature,
        });
        setMessage({
          ok: true,
          text: t('withdrawSent', { amount: formatUsdc(value, locale) }),
          tx: explorerTx(chain.chainId, txHash),
        });
        setAmount('');
        refreshWithdrawals();
        return;
      }
      setMessage({ ok: false, text: t('withdrawRejected') });
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  }

  const wrongWallet = address !== undefined && address.toLowerCase() !== account.toLowerCase();
  return (
    <section aria-labelledby={`${inputId}-title`} className="space-y-3 text-xs">
      <h2 id={`${inputId}-title`} className="text-sm font-medium">
        {t('title')}
      </h2>
      <dl className="grid grid-cols-2 gap-y-1 font-mono tabular-nums">
        <dt className="font-sans text-muted-foreground">{t('walletBalance')}</dt>
        <dd className="text-right">
          {walletBalance === undefined ? '–' : formatUsdc(walletBalance, locale)}
        </dd>
        <dt className="font-sans text-muted-foreground">{t('claimable')}</dt>
        <dd className="text-right">
          {claimable === undefined ? '–' : formatUsdc(claimable, locale)}
        </dd>
      </dl>
      {wrongWallet && <p className="text-destructive">{t('wrongWallet')}</p>}
      <div>
        <label htmlFor={inputId} className="mb-1 block text-muted-foreground">
          {t('amount')}
        </label>
        <input
          id={inputId}
          inputMode="decimal"
          autoComplete="off"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="h-8 w-full rounded-md border border-border bg-transparent px-2 font-mono tabular-nums"
        />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={busy !== null || wrongWallet}
          onClick={() => void claim()}
        >
          {busy === 'claim' ? '…' : t('claim')}
        </Button>
        <Button size="sm" disabled={busy !== null || wrongWallet} onClick={() => void deposit()}>
          {busy === 'deposit' ? '…' : t('deposit')}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={busy !== null || wrongWallet}
          onClick={() => void withdraw()}
        >
          {busy === 'withdraw' ? '…' : t('withdraw')}
        </Button>
      </div>
      <p className="text-muted-foreground">{t('gasless')}</p>
      <div aria-live="polite">
        {message !== null && (
          <p className={message.ok ? 'text-foreground' : 'text-destructive'}>
            {message.text}{' '}
            {message.tx !== undefined && (
              <a href={message.tx} target="_blank" rel="noreferrer" className="underline">
                {t('viewTx')}
              </a>
            )}
          </p>
        )}
      </div>
      {withdrawals.length > 0 && (
        <ul aria-label={t('withdrawals')} className="space-y-1">
          {withdrawals.slice(0, 5).map((w) => (
            <li key={w.id} className="flex justify-between font-mono tabular-nums">
              <span>{formatUsdc(BigInt(w.amount), locale)}</span>
              <span className="font-sans text-muted-foreground">
                {w.status === 'pending'
                  ? w.authorisation === null
                    ? t('statusAuthorising')
                    : t('statusSending')
                  : t(w.status === 'executed' ? 'statusPaid' : 'statusExpired')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
