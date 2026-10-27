import { useTranslations } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { use } from 'react';
import { buttonVariants } from '@euroedge/ui/components/button-variants';
import { Link } from '@/i18n/navigation';
import { LocaleSwitch } from '@/components/locale-switch';
import { ThemeToggle } from '@/components/theme-toggle';

export default function HomePage({ params }: PageProps<'/[locale]'>) {
  const { locale } = use(params);
  setRequestLocale(locale);
  const t = useTranslations('Home');

  return (
    <main id="main" className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-16">
      <div className="flex items-center justify-between">
        <span translate="no" className="text-sm font-semibold">
          EuroEdge
        </span>
        <div className="flex items-center gap-2">
          <LocaleSwitch />
          <ThemeToggle />
        </div>
      </div>
      <h1 className="max-w-2xl text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
        {t('headline')}
      </h1>
      <p className="text-muted-foreground">{t('status')}</p>
      <div>
        <Link href="/trade" className={buttonVariants({ size: 'lg' })}>
          {t('openTerminal')}
        </Link>
      </div>
    </main>
  );
}
