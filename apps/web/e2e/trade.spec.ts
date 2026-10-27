import { expect, test } from '@playwright/test';

// M1 acceptance: in the browser I see live mark/FV/band and can open and close a position.
test('dev login → buy → see position → close', async ({ page }) => {
  await page.goto('/en');
  await page.getByRole('link', { name: 'Open the testnet terminal' }).click();
  await expect(page).toHaveURL(/\/en\/trade$/);
  await expect(page.getByText('SIMULATED PRICES')).toBeVisible();
  await expect(page.getByText('Fair value', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Start with play money' }).click();
  await expect(page.getByText('Equity')).toBeVisible({ timeout: 15_000 });

  await page.getByLabel('Size (contracts)').fill('1.00');
  await page.getByRole('button', { name: /^Buy 1\.00 contracts$/ }).click();
  await expect(page.locator('form [role=status]')).toContainText(/Buy 1\.00 filled at/);

  const row = page.getByRole('row', { name: /ASML-PERP/ });
  await expect(row).toContainText('+1.00');
  await row.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByText(/Position closed, realized/)).toBeVisible();
  await expect(page.getByText('No open positions.')).toBeVisible();
});

test('rejects an order beyond the window leverage cap with a clear message', async ({ page }) => {
  await page.goto('/en/trade');
  await page.getByRole('button', { name: 'Start with play money' }).click();
  await expect(page.getByText('Equity')).toBeVisible({ timeout: 15_000 });
  await page.getByLabel('Size (contracts)').fill('500');
  await page.getByRole('button', { name: /^Buy 500 contracts$/ }).click();
  await expect(page.locator('form [role=status]')).toContainText('Not enough margin');
});
