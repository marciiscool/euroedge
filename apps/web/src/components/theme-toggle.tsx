'use client';

import { Button } from '@euroedge/ui/components/button';
import { Moon, Sun } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};

export function ThemeToggle() {
  const t = useTranslations('Theme');
  const { resolvedTheme, setTheme } = useTheme();
  // The theme is only known on the client; render a stable placeholder on the server.
  const mounted = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const next = resolvedTheme === 'light' ? 'dark' : 'light';

  return (
    <Button
      variant="outline"
      size="icon"
      aria-label={t('toggle', { theme: t(next) })}
      disabled={!mounted}
      onClick={() => setTheme(next)}
    >
      {mounted && next === 'dark' ? <Moon aria-hidden /> : <Sun aria-hidden />}
    </Button>
  );
}
