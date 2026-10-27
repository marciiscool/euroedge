'use client';

import { cn } from '@euroedge/ui/lib/utils';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { MARKETS } from '@/lib/markets';

export function MarketSwitcher({ current }: { current: string }) {
  const t = useTranslations('Terminal');
  return (
    <nav aria-label={t('markets')} className="border-b border-border px-2">
      <ul className="flex gap-1 overflow-x-auto">
        {MARKETS.map((m) => (
          <li key={m.id}>
            <Link
              href={{ pathname: '/trade', query: { market: m.id } }}
              aria-current={m.id === current ? 'page' : undefined}
              className={cn(
                'inline-flex h-9 items-center px-3 font-mono text-xs whitespace-nowrap transition-colors duration-(--duration-fast)',
                m.id === current
                  ? 'border-b-2 border-foreground text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
              translate="no"
            >
              {m.id}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
