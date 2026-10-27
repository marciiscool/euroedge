'use client';

import { ThemeProvider as NextThemes } from 'next-themes';
import type { ReactNode } from 'react';

// Dark by default, light optional (brief §11.1). Theme is a class on <html> (tokens.css).
export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemes
      attribute="class"
      defaultTheme="dark"
      themes={['dark', 'light']}
      enableSystem={false}
      disableTransitionOnChange
    >
      {children}
    </NextThemes>
  );
}
