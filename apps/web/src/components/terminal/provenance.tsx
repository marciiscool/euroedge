'use client';

import type { FvDisplaySnapshot } from '@euroedge/shared';
import { useLocale, useTranslations } from 'next-intl';
import { formatNumber, formatTime } from '@/lib/format';

/** Transparency strip: which sources make up FV, with weights and ages (brief §11.2). */
export function Provenance({ fv }: { fv: FvDisplaySnapshot | undefined }) {
  const t = useTranslations('Terminal');
  const locale = useLocale();
  if (fv === undefined) return null;
  return (
    <section
      aria-label={t('provenance')}
      className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border px-4 py-2 text-xs"
    >
      <span className="text-muted-foreground">{t('sources')}</span>
      {fv.sources.length === 0 ? (
        <span>{t('noLiveSource')}</span>
      ) : (
        fv.sources.map((s) => (
          <span key={s.kind} className="font-mono tabular-nums">
            {t(`source.${s.kind}`)} {formatNumber(s.weight * 100, locale, 0)} % ·{' '}
            {formatNumber(s.ageMs / 1000, locale, 0)} s
          </span>
        ))
      )}
      <span className="text-muted-foreground">
        {t('anchor', {
          price: formatNumber(fv.anchor.price, locale),
          time: formatTime(fv.anchor.ts, locale),
        })}
      </span>
    </section>
  );
}
