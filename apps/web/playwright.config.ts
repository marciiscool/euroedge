import { defineConfig, devices } from '@playwright/test';

/**
 * E2E against the running stack behind Caddy (http://localhost:8080). Start it with
 * `pnpm infra:up && pnpm build && scripts/stack.sh start` (CI does the same).
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: process.env['CI'] === undefined ? 0 : 1,
  reporter: process.env['CI'] === undefined ? 'list' : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env['E2E_BASE_URL'] ?? 'http://localhost:8080',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
