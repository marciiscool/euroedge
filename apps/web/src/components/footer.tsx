import { useTranslations } from 'next-intl';

export function Footer() {
  const t = useTranslations('Footer');
  return (
    <footer className="border-t border-border py-6 text-xs text-muted-foreground">
      <div className="mx-auto flex max-w-5xl flex-col gap-2 px-4">
        <p>{t('riskWarning')}</p>
        <p>{t('chartsNotice')}</p>
      </div>
    </footer>
  );
}
