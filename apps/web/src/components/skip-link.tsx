import { useTranslations } from 'next-intl';

/** WCAG 2.4.1: first focusable element jumps to the main content. */
export function SkipLink() {
  const t = useTranslations('Layout');
  return (
    <a
      href="#main"
      className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
    >
      {t('skipToContent')}
    </a>
  );
}
