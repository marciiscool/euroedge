'use client';

import { buttonVariants } from '@euroedge/ui/components/button';
import { useLocale, useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';

export function LocaleSwitch() {
  const t = useTranslations('Locale');
  const locale = useLocale();
  const pathname = usePathname();
  const other = locale === 'en' ? 'de' : 'en';

  return (
    <Link
      href={pathname}
      locale={other}
      aria-label={t('switch')}
      className={buttonVariants({ variant: 'outline', size: 'sm' })}
    >
      {other.toUpperCase()}
    </Link>
  );
}
