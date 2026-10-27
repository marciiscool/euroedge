import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing.ts';

// Next 16 "proxy" (formerly middleware): locale negotiation and prefixing.
export default createMiddleware(routing);

export const config = {
  matcher: ['/((?!api|ws|_next|_vercel|.*\\..*).*)'],
};
