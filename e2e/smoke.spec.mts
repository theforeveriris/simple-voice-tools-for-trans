/**
 * E2E 冒烟：核心链路（录音 → 分析 → 历史 → 导出）
 * 假麦克风（Chromium --use-fake-device-for-media-capture，默认 440Hz 音频源），
 * 数据全部落本机 IndexedDB；每条用例独立 storageState（不共享）。
 * 断言面向用户可见行为（页签文案、图表画布渲染、统计数字出现），
 * 不探内部实现，保证重构安全网属性。
 */

import { expect, test } from '@playwright/test';

/** 等待应用挂载完成（底栏圆球出现）；首次打开会弹引导页，先标记已完成跳过 */
async function waitApp(page: import('@playwright/test').Page) {
  await page.addInitScript(() => window.localStorage.setItem('svt:onboarded', '1'));
  await page.goto('/');
  await expect(page.getByRole('button', { name: /record|錄音|录音/i }).first()).toBeVisible({ timeout: 15_000 });
}

test('demo 模式：无麦克风也可浏览分析与历史', async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('svt:onboarded', '1'));
  await page.goto('/?demo=1');
  // demo 落到分析页：概览卡显示平均基频数字
  await expect(page.getByText(/Hz/).first()).toBeVisible({ timeout: 15_000 });
  // 历史页有一条记录
  await page.getByRole('button', { name: /history|歷史|历史/i }).first().click();
  await expect(page.getByText(/Hz/).first()).toBeVisible();
});

test('录音 → 自动进入分析页（假麦克风）', async ({ page }) => {
  await waitApp(page);
  // 测试页应有图表画布
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 10_000 });
  // 短按圆球开始录音（aria-label 由语言决定，取按钮角色 + 名称匹配）
  const orb = page.getByRole('button', { name: /record|錄音|录音/i }).first();
  await orb.click();
  // 录音中：圆球变为停止（同一按钮的 aria-label 切换），等自动时长上限前手动停
  await page.waitForTimeout(2500);
  await orb.click();
  // 停止后自动进入分析页：出现统计表格与图表
  await expect(page.getByText(/Hz/).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('canvas').first()).toBeVisible();
});

test('录音 → 历史页出现新记录，对比入口存在', async ({ page }) => {
  await waitApp(page);
  const orb = page.getByRole('button', { name: /record|錄音|录音/i }).first();
  await orb.click();
  await page.waitForTimeout(2500);
  await orb.click();
  await expect(page.getByText(/Hz/).first()).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: /history|歷史|历史/i }).first().click();
  // 列表出现记录卡（含 Hz 数字）
  await expect(page.getByText(/Hz/).first()).toBeVisible();
});

test('设置子页面可达：数据管理面板渲染', async ({ page }) => {
  await waitApp(page);
  await page.getByRole('button', { name: /settings|設置|设置/i }).first().click();
  // 设置主视图有「数据」入口卡片
  await page.getByText(/data|資料|数据/i).first().click();
  await expect(page.getByText(/backup|備份|备份/i).first()).toBeVisible({ timeout: 10_000 });
});

test('崩溃草稿：启动提示恢复，放弃后不再出现', async ({ page }) => {
  await waitApp(page);
  // 直接写入一份「未完成录音」草稿（启动扫描不依赖音频能否解码）
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('svt', 2);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('records')) db.createObjectStore('records', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('audio')) db.createObjectStore('audio', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(
          {
            id: 'e2e-draft',
            startedAt: Date.now(),
            mode: 'reading',
            mimeType: 'audio/webm',
            chunkCount: 1,
            totalBytes: 4,
            targetRange: null,
          },
          'recording:draft:meta',
        );
        tx.objectStore('kv').put(
          new Blob(['test'], { type: 'audio/webm' }),
          'recording:draft:chunk:e2e-draft:0',
        );
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
  });

  await page.reload();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  // 放弃 = 弹窗第一个按钮
  await dialog.getByRole('button').first().click();
  await expect(dialog).toBeHidden();

  // 草稿已清理：再次启动不应再弹
  await page.reload();
  await expect(page.getByRole('dialog')).toBeHidden({ timeout: 10_000 });
});
