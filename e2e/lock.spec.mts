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

test('duress PIN opens the decoy library without real records', async ({ page }) => {
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

  // 设置第二 PIN（当前真实 PIN + 两次新 PIN）
  await page.getByRole('button', { name: 'Set', exact: true }).click();
  const duressPins = page.locator('input[type=password]');
  await duressPins.nth(0).fill('123456');
  await duressPins.nth(1).fill('654321');
  await duressPins.nth(2).fill('654321');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Set: entering it opens an empty demo library')).toBeVisible();

  await page.getByRole('button', { name: 'Lock now', exact: true }).click();
  for (const digit of ['6', '5', '4', '3', '2', '1']) {
    await page.getByRole('button', { name: digit, exact: true }).click();
  }
  await expect(page.getByText('On-device voice practice', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Lock app', exact: true })).toBeVisible();

  // 诱饵库锁定后，真实 PIN 才回到真实设置页
  await page.getByRole('button', { name: 'Lock app', exact: true }).click();
  for (const digit of ['1', '2', '3', '4', '5', '6']) {
    await page.getByRole('button', { name: digit, exact: true }).click();
  }
  await expect(page.getByRole('button', { name: 'Privacy & Security', exact: true })).toBeVisible();
});
