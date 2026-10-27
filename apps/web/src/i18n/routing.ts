import { defineRouting } from 'next-intl/routing';

// English default, German second (formal "Sie"), brief §11.1.
export const routing = defineRouting({
  locales: ['en', 'de'],
  defaultLocale: 'en',
  localePrefix: 'always',
});

export type Locale = (typeof routing.locales)[number];
