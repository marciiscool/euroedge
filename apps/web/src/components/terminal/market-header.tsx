'use client';

import type { FvDisplaySnapshot, MarketSnapshot } from '@euroedge/shared';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { formatCountdown, formatNumber, formatTime } from '@/lib/format';

export function MarketHeader({
  market,
  fv,
  simulated,
  live,
}: {
  market: MarketSnapshot | undefined;
  fv: FvDisplaySnapshot | undefined;
  simulated: boolean;
  live: 'connecting' | 'open' | 'closed';
}) {
  const t = useTranslations('Terminal');
  const locale = useLocale();
  // The clock starts on the client only: the static shell must not read the time (Cache Components).
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const id = setInterval(tick, 1000);
    queueMicrotask(tick);
    return () => clearInterval(id);
  }, []);
  const w = fv?.window ?? market?.window;
  const offHours = w !== undefined && w !== 'A';
  const next = fv?.nextWindowChange;

  return (
    <header className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-border px-4 py-3">
      <div className="flex items-baseline gap-2">
        <h1 className="text-base font-semibold">{t('assetName')}</h1>
        <span translate="no" className="font-mono text-xs text-muted-foreground">
          ASML-PERP
        </span>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="sr-only">{t('mark')}</span>
        <span className="font-mono text-xl font-semibold tabular-nums" aria-live="off">
          {market === undefined ? '—' : formatNumber(market.mark, locale)}
        </span>
        <span className="text-xs text-muted-foreground">EUR</span>
        {offHours && (
          <span className="rounded-sm border border-warning/50 px-1.5 py-0.5 text-[11px] text-warning">
            {t('modelPrice')} · {t(`confidence.${fv?.confidence ?? 'none'}`)}
          </span>
        )}
      </div>
      <dl className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
        <Stat label={t('fairValue')} value={fv === undefined ? '—' : formatNumber(fv.fv, locale)} />
        <Stat
          label={t('band')}
          value={
            fv === undefined
              ? '—'
              : `${formatNumber(fv.bandLo, locale)} – ${formatNumber(fv.bandHi, locale)}`
          }
        />
        <Stat
          label="σ"
          value={fv === undefined ? '—' : `${formatNumber(fv.sigmaBp, locale, 1)} bp`}
        />
      </dl>
      <div className="flex items-center gap-2 text-xs">
        {w !== undefined && (
          <span
            className="rounded-full bg-secondary px-2.5 py-1 font-medium"
            title={t(`windowHint.${w}`)}
          >
            {t(`window.${w}`)} · {t('maxLeverage', { lev: market?.maxLeverage ?? 0 })}
          </span>
        )}
        {next !== null && next !== undefined && now !== null && (
          <span className="text-muted-foreground">
            {t('nextWindow', {
              window: t(`window.${next.window}`),
              time: formatTime(next.at, locale),
              in: formatCountdown(next.at - now),
            })}
          </span>
        )}
      </div>
      <div className="ml-auto flex items-center gap-3 text-xs">
        {simulated && (
          <span className="rounded-sm bg-warning px-2 py-0.5 font-semibold tracking-wide text-warning-foreground">
            {t('simulated')}
          </span>
        )}
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <span
            aria-hidden
            className={`size-2 rounded-full ${live === 'open' ? 'bg-up' : live === 'connecting' ? 'bg-warning' : 'bg-down'}`}
          />
          {t(`live.${live}`)}
        </span>
      </div>
    </header>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-1.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-mono tabular-nums">{value}</dd>
    </div>
  );
}
