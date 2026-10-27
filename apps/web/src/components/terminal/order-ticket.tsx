'use client';

import { Button } from '@euroedge/ui/components/button';
import { cn } from '@euroedge/ui/lib/utils';
import type { MarketSnapshot, OrderResult } from '@euroedge/shared';
import { useLocale, useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { formatNumber } from '@/lib/format';

export function OrderTicket({
  market,
  loggedIn,
  onFilled,
}: {
  market: MarketSnapshot | undefined;
  loggedIn: boolean;
  onFilled: () => void;
}) {
  const t = useTranslations('Terminal');
  const locale = useLocale();
  const sizeId = useId();
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [size, setSize] = useState('1.00');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const price = market === undefined ? undefined : Number(side === 'buy' ? market.ask : market.bid);
  const qty = Number(size);
  const validSize = /^\d+(\.\d{1,2})?$/.test(size) && qty > 0;
  const notional = price !== undefined && validSize ? qty * price : undefined;
  const fee =
    notional !== undefined && market !== undefined
      ? (notional * market.takerFeeBps) / 10_000
      : undefined;
  const margin =
    notional !== undefined && market !== undefined && market.maxLeverage > 0
      ? notional / market.maxLeverage
      : undefined;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (market === undefined || !validSize) return;
    setBusy(true);
    setStatus(null);
    try {
      const r: OrderResult = await api.placeOrder({ market: market.market, side, size });
      if (r.status === 'filled') {
        setStatus({
          kind: 'ok',
          text: t('filled', {
            side: t(r.fill.side),
            size: r.fill.size,
            price: formatNumber(r.fill.price, locale),
            fee: formatNumber(r.fill.fee, locale),
          }),
        });
        onFilled();
      } else {
        setStatus({ kind: 'error', text: t(`reject.${r.reason}`) });
      }
    } catch (err) {
      setStatus({ kind: 'error', text: err instanceof ApiError ? err.message : t('networkError') });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(e) => void submit(e)}
      className="flex flex-col gap-3 p-4"
      aria-labelledby={`${sizeId}-title`}
    >
      <h2 id={`${sizeId}-title`} className="text-sm font-semibold">
        {t('orderTicket')}
      </h2>
      <div
        role="radiogroup"
        aria-label={t('side')}
        className="grid grid-cols-2 gap-1 rounded-md bg-secondary p-1"
      >
        {(['buy', 'sell'] as const).map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={side === s}
            onClick={() => setSide(s)}
            className={cn(
              'h-8 rounded-sm text-sm font-medium transition-colors duration-(--duration-fast)',
              side === s
                ? s === 'buy'
                  ? 'bg-up text-up-foreground'
                  : 'bg-down text-down-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {s === 'buy' ? '▲ ' : '▼ '}
            {t(s)}
          </button>
        ))}
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={sizeId} className="text-xs text-muted-foreground">
          {t('size')}
        </label>
        <input
          id={sizeId}
          name="size"
          inputMode="decimal"
          autoComplete="off"
          value={size}
          onChange={(e) => setSize(e.target.value.replace(',', '.'))}
          aria-invalid={!validSize}
          className="h-9 rounded-md border border-input bg-transparent px-3 font-mono text-sm tabular-nums focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        />
      </div>
      <dl className="grid grid-cols-2 gap-y-1 text-xs">
        <dt className="text-muted-foreground">{t('estPrice')}</dt>
        <dd className="text-right font-mono tabular-nums">
          {price === undefined ? '—' : formatNumber(price, locale)}
        </dd>
        <dt className="text-muted-foreground">{t('notional')}</dt>
        <dd className="text-right font-mono tabular-nums">
          {notional === undefined ? '—' : `${formatNumber(notional, locale)} USDC`}
        </dd>
        <dt className="text-muted-foreground">{t('fee', { bps: market?.takerFeeBps ?? 0 })}</dt>
        <dd className="text-right font-mono tabular-nums">
          {fee === undefined ? '—' : `${formatNumber(fee, locale)} USDC`}
        </dd>
        <dt className="text-muted-foreground">{t('margin', { lev: market?.maxLeverage ?? 0 })}</dt>
        <dd className="text-right font-mono tabular-nums">
          {margin === undefined ? '—' : `${formatNumber(margin, locale)} USDC`}
        </dd>
      </dl>
      <Button
        type="submit"
        variant={side === 'buy' ? 'up' : 'down'}
        size="lg"
        disabled={!loggedIn || !validSize || busy || market === undefined}
      >
        {busy ? t('submitting') : t('submit', { side: t(side), size: validSize ? size : '—' })}
      </Button>
      {!loggedIn && <p className="text-xs text-muted-foreground">{t('loginToTrade')}</p>}
      <p
        role="status"
        aria-live="polite"
        className={cn(
          'min-h-5 text-xs',
          status?.kind === 'error' ? 'text-down' : 'text-foreground',
        )}
      >
        {status?.text}
      </p>
    </form>
  );
}
