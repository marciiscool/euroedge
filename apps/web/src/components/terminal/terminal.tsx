'use client';

import { Button } from '@euroedge/ui/components/button';
import type { AccountSnapshot, FvDisplaySnapshot, MarketSnapshot } from '@euroedge/shared';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { api, type Session } from '@/lib/api';
import { live, useChannel, useLiveStatus } from '@/lib/live';
import { marketById } from '@/lib/markets';
import { MarketHeader } from './market-header';
import { MarketSwitcher } from './market-switcher';
import { OrderTicket } from './order-ticket';
import { AccountSummary, Positions } from './positions';
import { PriceChart } from './price-chart';
import { Provenance } from './provenance';

/** Bare trade terminal: enabled markets, sim data, market orders. The full terminal is M7. */
export function Terminal() {
  const marketCfg = marketById(useSearchParams().get('market'));
  const MARKET = marketCfg.id;
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

  async function devLogin() {
    await api.devLogin('trader');
    setSession(await api.session());
    live().reconnect(); // re-bind the account channel to the new session cookie
  }

  return (
    <div className="flex min-h-[calc(100dvh-8rem)] flex-col">
      <MarketSwitcher current={MARKET} />
      <MarketHeader
        id={MARKET}
        name={marketCfg.name}
        market={market}
        fv={fv}
        simulated={session?.tier !== 'live-min'}
        live={status}
      />
      <div className="grid flex-1 grid-cols-1 lg:grid-cols-[1fr_320px]">
        <div className="flex min-w-0 flex-col">
          <PriceChart key={MARKET} market={MARKET} fv={fv} />
          <Provenance fv={fv} />
          <Positions account={shown} onClosed={refreshAccount} />
        </div>
        <aside
          id="order-ticket"
          aria-label={t('orderTicket')}
          className="border-t border-border lg:border-t-0 lg:border-l"
        >
          {session !== null && session.account === null && session.devLogin && (
            <div className="border-b border-border p-4">
              <p className="mb-2 text-xs text-muted-foreground">{t('devLoginHint')}</p>
              <Button onClick={() => void devLogin()} variant="secondary">
                {t('devLogin')}
              </Button>
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
