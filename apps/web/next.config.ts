import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const config: NextConfig = {
  reactStrictMode: true,
  // Workspace packages ship TypeScript source (ADR-0011).
  transpilePackages: ['@euroedge/ui', '@euroedge/shared'],
  poweredByHeader: false,
  typedRoutes: true,
  // Partial prerendering for the app shell (brief §11.1).
  cacheComponents: true,
};

export default withNextIntl(config);
