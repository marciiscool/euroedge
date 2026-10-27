import { defineConfig } from 'vitest/config';

// Root entry point: `pnpm vitest` runs every workspace project in one process.
// Per-package runs (`turbo run test`) use each package's own vitest.config.ts.
export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/*'],
  },
});
