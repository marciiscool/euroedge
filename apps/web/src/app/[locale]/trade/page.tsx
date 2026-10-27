import { setRequestLocale } from 'next-intl/server';
import { Suspense, use } from 'react';
import { Terminal } from '@/components/terminal/terminal';

export default function TradePage({ params }: PageProps<'/[locale]/trade'>) {
  const { locale } = use(params);
  setRequestLocale(locale);
  return (
    <main id="main" className="flex flex-1 flex-col">
      <Suspense>
        <Terminal />
      </Suspense>
    </main>
  );
}
