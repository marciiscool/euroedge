import type { NextConfig } from 'next';
import { loadEnv } from '@euroedge/shared/config';
import createNextIntlPlugin from 'next-intl/plugin';

// Fails dev and build if DEV_LOGIN is enabled outside DATA_TIER=sim in local/ci (founder rule).
loadEnv({});

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
