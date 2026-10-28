'use client';

import { Button } from '@euroedge/ui/components/button';
import { useLogin, usePrivy, useWallets } from '@privy-io/react-auth';
import { useTranslations } from 'next-intl';
import { Component, useEffect, useRef, useState, type ReactNode } from 'react';
import { getAddress } from 'viem';
import { api } from '@/lib/api';
import { shortAccount } from '@/lib/format';
import { Funds } from './funds';
import { signInMessage } from './siwe-message';
import { WalletProvider } from './wallet-provider';

interface Props {
  readonly account: string | null;
  readonly onChange: () => void;
}

/** Email, Google or wallet via Privy, then our own SIWE session (ADR-0020). */
export function WalletSignIn(props: Props) {
  return (
    <Contained fallback={<Unavailable />}>
      <WalletProvider>
        <SignIn {...props} />
      </WalletProvider>
    </Contained>
  );
}

/** A Privy failure (bad app id, blocked script) must never take the terminal down. */
class Contained extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function Unavailable() {
  const t = useTranslations('Terminal');
  return <p className="text-xs text-muted-foreground">{t('signInUnavailable')}</p>;
}

function SignIn({ account, onChange }: Props) {
  const t = useTranslations('Terminal');
  const { ready, authenticated, logout } = usePrivy();
  const { wallets, ready: walletsReady } = useWallets();
  const { login } = useLogin();
  const [failed, setFailed] = useState(false);
  const busy = useRef(false);

  // Once Privy has a wallet and we have no session, sign our SIWE message with it.
  useEffect(() => {
    if (account !== null || !authenticated || !walletsReady || busy.current) return;
    const wallet = wallets.find((w) => w.walletClientType === 'privy') ?? wallets[0];
    if (wallet === undefined) return;
    busy.current = true;
    void (async () => {
      try {
        const nonce = await api.nonce();
        const message = signInMessage(
          nonce,
          getAddress(wallet.address),
          window.location.origin,
          new Date(),
        );
        await api.siwe(message, await wallet.sign(message));
        setFailed(false);
        onChange();
      } catch {
        setFailed(true);
        await logout(); // back to a clean state; the user can retry
      } finally {
        busy.current = false;
      }
    })();
  }, [account, authenticated, walletsReady, wallets, logout, onChange]);

  async function signOut() {
    await api.logout();
    await logout();
    onChange();
  }

  if (account !== null)
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="font-mono text-muted-foreground" title={account}>
            {t('signedInAs', { account: shortAccount(account) })}
          </span>
          <Button variant="ghost" size="sm" onClick={() => void signOut()}>
            {t('signOut')}
          </Button>
        </div>
        {/^0x[0-9a-f]{40}$/i.test(account) && <Funds account={account} />}
      </div>
    );

  const signing = authenticated && !failed;
  return (
    <div>
      <p className="mb-2 text-xs text-muted-foreground">{t('signInHint')}</p>
      <Button
        onClick={() => {
          setFailed(false);
          login();
        }}
        disabled={!ready || signing}
      >
        {signing ? t('signingIn') : t('signIn')}
      </Button>
      {failed && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {t('signInFailed')}
        </p>
      )}
    </div>
  );
}
