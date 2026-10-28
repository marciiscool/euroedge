'use client';

import { Button } from '@euroedge/ui/components/button';
import type { AccountSnapshot, FvDisplaySnapshot, MarketSnapshot } from '@euroedge/shared';
import { useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { api, type Session } from '@/lib/api';
import { live, useChannel, useLiveStatus } from '@/lib/live';
import { shortAccount } from '@/lib/format';
import { useMarkets } from '@/lib/markets';
import { walletSignInEnabled } from '@/wallet/config';
import { MarketHeader } from './market-header';
import { MarketSwitcher } from './market-switcher';
import { OrderTicket } from './order-ticket';
import { AccountSummary, Positions } from './positions';
import { PriceChart } from './price-chart';
import { Provenance } from './provenance';

// Privy + wagmi load only in the browser and only here (shell budget, ADR-0020).
const WalletSignIn = dynamic(() => import('@/wallet/sign-in').then((m) => m.WalletSignIn), {
  ssr: false,
});

/** Bare trade terminal: enabled markets, sim data, market orders. The full terminal is M7. */
export function Terminal() {
  const markets = useMarkets();
  const MARKET = useSearchParams().get('market') ?? 'ASML-PERP';
  const name = markets.find((m) => m.id === MARKET)?.displayName ?? MARKET;
  const t = useTranslations('Terminal');
  const [session, setSession] = useState<Session | null>(null);
  const [account, setAccount] = useState<AccountSnapshot | undefined>();
  const market = useChannel<MarketSnapshot>(`market:${MARKET}`);
  const fv = useChannel<FvDisplaySnapshot>(`fv:${MARKET}`);
  const liveAccount = useChannel<AccountSnapshot>('account');
  const status = useLiveStatus();

  useEffect(() => {
    api
      .session()
      .then(setSession, () => setSession({ account: null, devLogin: false, tier: 'sim' }));
  }, []);
  const refreshAccount = useCallback(() => {
    api.account().then(setAccount, () => setAccount(undefined));
  }, []);
  useEffect(() => {
    if (typeof session?.account === 'string') refreshAccount();
  }, [session, refreshAccount]);
  const shown = liveAccount ?? account;

  const refreshSession = useCallback(() => {
    api.session().then(
      (s) => {
        setSession(s);
        if (s.account === null) setAccount(undefined);
        live().reconnect(); // re-bind the account channel to the new session cookie
      },
      () => undefined,
    );
  }, []);

  async function devLogin() {
    await api.devLogin('trader');
    refreshSession();
  }

  async function signOut() {
    await api.logout();
    refreshSession();
  }

  return (
    <div className="flex min-h-[calc(100dvh-8rem)] flex-col">
      <MarketSwitcher current={MARKET} markets={markets} />
      <MarketHeader
        id={MARKET}
        name={name}
        market={market}
        fv={fv}
        simulated={session?.tier !== 'live-min'}
        live={status}
      />
      <div className="grid flex-1 grid-cols-1 lg:grid-cols-[1fr_320px]">
        <div className="flex min-w-0 flex-col">
          <PriceChart key={MARKET} market={MARKET} fv={fv} lotSize={market?.lotSize} />
          <Provenance fv={fv} />
          <Positions account={shown} onClosed={refreshAccount} />
        </div>
        <aside
          id="order-ticket"
          aria-label={t('orderTicket')}
          className="border-t border-border lg:border-t-0 lg:border-l"
        >
          {session !== null &&
            (walletSignInEnabled || session.account !== null || session.devLogin) && (
              <div className="space-y-3 border-b border-border p-4">
                {walletSignInEnabled ? (
                  <WalletSignIn account={session.account} onChange={refreshSession} />
                ) : (
                  session.account !== null && (
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-mono text-muted-foreground" title={session.account}>
                        {t('signedInAs', { account: shortAccount(session.account) })}
                      </span>
                      <Button variant="ghost" size="sm" onClick={() => void signOut()}>
                        {t('signOut')}
                      </Button>
                    </div>
                  )
                )}
                {session.account === null && session.devLogin && (
                  <div>
                    <p className="mb-2 text-xs text-muted-foreground">{t('devLoginHint')}</p>
                    <Button onClick={() => void devLogin()} variant="secondary">
                      {t('devLogin')}
                    </Button>
                  </div>
                )}
              </div>
            )}
          <OrderTicket
            market={market}
            loggedIn={typeof session?.account === 'string'}
            onFilled={refreshAccount}
          />
          <AccountSummary account={shown} />
        </aside>
      </div>
    </div>
  );
}
