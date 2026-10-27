import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

// Founder rule (M0 review): axe on every existing page, failing on serious/critical
// violations, in both themes and both locales. WCAG 2.2 AA tags.
const PAGES = ['/en', '/de', '/en/trade', '/de/trade'];
const THEMES = ['dark', 'light'] as const;

for (const path of PAGES) {
  for (const theme of THEMES) {
    test(`a11y ${path} (${theme})`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem('theme', t), theme);
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      const blocking = results.violations.filter(
        (v) => v.impact === 'serious' || v.impact === 'critical',
      );
      expect(
        blocking.map(
          (v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
        ),
      ).toEqual([]);
    });
  }
}
