import { useTranslations } from 'next-intl';

/** Persistent, non-dismissible testnet notice (brief §11.5). */
export function TestnetBanner() {
  const t = useTranslations('Banner');
  return (
    <div
      role="note"
      className="sticky top-0 z-50 border-b border-warning/40 bg-warning/10 px-4 py-1.5 text-center text-xs text-foreground"
    >
      <strong className="mr-2 rounded-sm bg-warning px-1.5 py-0.5 font-semibold text-warning-foreground uppercase">
        {t('testnet')}
      </strong>
      {t('text')}
    </div>
  );
}
