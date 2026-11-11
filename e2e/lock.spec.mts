/**
 * 应用锁冒烟：开启 → 立即锁定 → 错误 PIN → 正确 PIN 解锁。
 * 生物识别在 CI 中不可用，因此只覆盖 PIN 主路径。
 */

import { expect, test } from '@playwright/test';

test('app lock: enable, reject a wrong PIN, then unlock', async ({ page }) => {
  test.setTimeout(150_000);
  await page.addInitScript(() => {
    window.localStorage.setItem('svt:onboarded', '1');
    window.localStorage.setItem(
      'svt:settings:v1',
      JSON.stringify({ state: { settings: { language: 'en' } }, version: 0 }),
    );
  });
  await page.goto('/#/settings', { waitUntil: 'domcontentloaded' });

  await page.getByRole('button', { name: 'Privacy & Security', exact: true }).click();
  await page.getByRole('switch').first().click();

  const pins = page.locator('input[type=password]');
  await pins.nth(0).fill('123456');
  await pins.nth(1).fill('123456');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Enable app lock', exact: true }).click();

  await expect(page.getByRole('button', { name: 'Lock now', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Lock now', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Forgot PIN?', exact: true })).toBeVisible();

  for (const digit of ['0', '0', '0', '0', '0', '0']) {
    await page.getByRole('button', { name: digit, exact: true }).click();
  }
  await expect(page.getByText('Incorrect PIN').first()).toBeVisible();

  for (const digit of ['1', '2', '3', '4', '5', '6']) {
    await page.getByRole('button', { name: digit, exact: true }).click();
  }
  await expect(page.getByRole('button', { name: 'Privacy & Security', exact: true })).toBeVisible();
});
