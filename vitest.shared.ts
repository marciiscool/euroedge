import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Base Vitest config shared by every workspace package:
 *   export default mergeConfig(shared, defineProject({ test: { name: 'fixed' } }));
 */
export const shared = defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    setupFiles: [fileURLToPath(new URL('./vitest.setup.ts', import.meta.url))],
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/main.ts'],
      reporter: ['text-summary', 'json-summary', 'lcov'],
    },
  },
});

/** Stricter coverage for the pure financial-maths packages (brief §15.4). */
export const coreCoverageThresholds = {
  lines: 95,
  branches: 90,
  functions: 95,
  statements: 95,
};
