'use client';

import { buttonVariants } from '@euroedge/ui/components/button-variants';
import { useLocale, useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';

export function LocaleSwitch() {
  const t = useTranslations('Locale');
  const locale = useLocale();
  const pathname = usePathname();
  const other = locale === 'en' ? 'de' : 'en';

  return (
    // WCAG 2.5.3: the accessible name starts with the visible text ("DE – Deutsch").
    <Link
      href={pathname}
      locale={other}
      hrefLang={other}
      className={buttonVariants({ variant: 'outline', size: 'sm' })}
    >
      {other.toUpperCase()}
      <span className="sr-only" lang={other}>
        {' – '}
        {t('targetName')}
      </span>
    </Link>
  );
}
