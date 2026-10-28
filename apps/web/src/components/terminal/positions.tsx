'use client';

import { Button } from '@euroedge/ui/components/button';
import type { AccountSnapshot } from '@euroedge/shared';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { api } from '@/lib/api';
import { direction, formatNumber, formatSigned } from '@/lib/format';

export function AccountSummary({ account }: { account: AccountSnapshot | undefined }) {
  const t = useTranslations('Terminal');
  const locale = useLocale();
  if (account === undefined) return null;
  const rows: [string, string][] = [
    [t('equity'), account.equity],
    [t('cash'), account.cash],
    [t('maintenance'), account.maintenance],
  ];
  return (
    <section aria-label={t('account')} className="border-t border-border p-4">
      <h2 className="mb-2 text-sm font-semibold">{t('account')}</h2>
      <dl className="grid grid-cols-2 gap-y-1 text-xs">
        {rows.map(([label, v]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="text-right font-mono tabular-nums">{formatNumber(v, locale)} USDC</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function Positions({
  account,
  onClosed,
}: {
  account: AccountSnapshot | undefined;
  onClosed: () => void;
}) {
  const t = useTranslations('Terminal');
  const locale = useLocale();
  const [closing, setClosing] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const positions = account?.positions ?? [];
  const orders = account?.orders ?? [];

  async function cancel(orderId: string) {
    setClosing(orderId);
    try {
      const r = await api.cancelOrder(orderId);
      setMessage(r.status === 'cancelled' ? t('orderCancelled') : t('cancelFailed'));
      onClosed();
    } finally {
      setClosing(null);
    }
  }

  async function close(market: string) {
    setClosing(market);
    try {
      const r = await api.close(market);
      setMessage(
        r.status === 'filled'
          ? t('closed', { pnl: formatSigned(r.fill.realized, locale) })
          : r.status === 'rejected'
            ? t(`reject.${r.reason}`)
            : '',
      );
      onClosed();
    } finally {
      setClosing(null);
    }
  }

  return (
    <section aria-label={t('positions')} className="border-t border-border">
      <h2 className="px-4 pt-3 text-sm font-semibold">{t('positions')}</h2>
      {positions.length === 0 ? (
        <p className="px-4 py-3 text-xs text-muted-foreground">{t('noPositions')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-muted-foreground">
              <tr>
                {['market', 'size', 'entry', 'markCol', 'upnl', 'liqPrice'].map((k) => (
                  <th key={k} scope="col" className="px-4 py-2 font-normal">
                    {t(k)}
                  </th>
                ))}
                <th scope="col" className="px-4 py-2">
                  <span className="sr-only">{t('actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody className="font-mono tabular-nums">
              {positions.map((p) => {
                const d = direction(p.upnl);
                return (
                  <tr key={p.market} className="border-t border-border">
                    <td className="px-4 py-2" translate="no">
                      {p.market}
                    </td>
                    <td className={`px-4 py-2 ${Number(p.size) > 0 ? 'text-up' : 'text-down'}`}>
                      {Number(p.size) > 0 ? '▲ ' : '▼ '}
                      {formatSigned(p.size, locale)}
                    </td>
                    <td className="px-4 py-2">
                      {p.entry === null ? '—' : formatNumber(p.entry, locale)}
                    </td>
                    <td className="px-4 py-2">
                      {p.mark === null ? '—' : formatNumber(p.mark, locale)}
                    </td>
                    <td
                      className={`px-4 py-2 ${d === 'up' ? 'text-up' : d === 'down' ? 'text-down' : ''}`}
                    >
                      {d === 'up' ? '▲ ' : d === 'down' ? '▼ ' : ''}
                      {formatSigned(p.upnl, locale)} USDC
                    </td>
                    <td className="px-4 py-2">
                      {p.liquidationPrice === null ? '—' : formatNumber(p.liquidationPrice, locale)}
                    </td>
                    <td className="px-4 py-2 text-right font-sans">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={closing === p.market}
                        onClick={() => void close(p.market)}
                      >
                        {t('close')}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {orders.length > 0 && (
        <div className="overflow-x-auto">
          <h3 className="px-4 pt-2 text-xs font-semibold">{t('openOrders')}</h3>
          <table className="w-full text-xs">
            <thead className="text-left text-muted-foreground">
              <tr>
                {['market', 'side', 'size', 'trigger', 'limitPrice'].map((k) => (
                  <th key={k} scope="col" className="px-4 py-2 font-normal">
                    {t(k)}
                  </th>
                ))}
                <th scope="col" className="px-4 py-2">
                  <span className="sr-only">{t('actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody className="font-mono tabular-nums">
              {orders.map((o) => (
                <tr key={o.orderId} className="border-t border-border">
                  <td className="px-4 py-2" translate="no">
                    {o.market}
                  </td>
                  <td className={`px-4 py-2 ${o.side === 'buy' ? 'text-up' : 'text-down'}`}>
                    {o.side === 'buy' ? '▲ ' : '▼ '}
                    {t(`${o.side}Noun`)}
                  </td>
                  <td className="px-4 py-2">{formatNumber(o.size, locale)}</td>
                  <td className="px-4 py-2">
                    {o.stop === null
                      ? '–'
                      : `${o.stop.triggersOn === 'rise' ? '≥' : '≤'} ${formatNumber(o.stop.price, locale)}`}
                  </td>
                  <td className="px-4 py-2">
                    {o.limitPrice === null ? t('atMarket') : formatNumber(o.limitPrice, locale)}
                  </td>
                  <td className="px-4 py-2 text-right font-sans">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={closing === o.orderId}
                      onClick={() => void cancel(o.orderId)}
                    >
                      {t('cancelOrder')}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p role="status" aria-live="polite" className="min-h-5 px-4 pb-2 text-xs">
        {message}
      </p>
    </section>
  );
}
