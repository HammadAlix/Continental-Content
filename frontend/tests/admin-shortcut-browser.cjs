/* eslint-disable @typescript-eslint/no-require-imports -- Local presentation tests; server auth is never mocked. */
const { chromium, expect } = require('@playwright/test');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const path = require('node:path');
const baseURL = 'http://localhost:3021';
let server, browser;
async function main() {
  server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--port', '3021'], {
    cwd: path.resolve(__dirname, '..'), env: { ...process.env, APP_URL: baseURL }, windowsHide: true, stdio: 'ignore',
  });
  let ready = false;
  for (let i = 0; i < 45; i++) {
    if (server.exitCode !== null) throw new Error('Preview stopped');
    try { if ((await fetch(baseURL + '/office')).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  assert.ok(ready);
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  let mode = 'allowed', calls = 0, finish;
  await page.route('**/api/admin/access', async route => {
    calls++;
    if (mode === 'held') await new Promise(resolve => { finish = resolve; });
    if (mode === 'offline') return route.abort();
    await route.fulfill({ status: mode === 'failure' ? 503 : 200, contentType: 'application/json', body: JSON.stringify({ allowed: mode !== 'denied' }) });
  });
  await page.goto(baseURL + '/?foyer=1');
  const link = page.getByRole('link', { name: 'Manage Store', exact: true });
  await expect(link).toBeVisible();
  // UI fixture cannot grant actual access: this request bypasses page interception.
  assert.equal((await page.request.get(baseURL + '/api/admin/products')).status(), 403);
  async function refresh(next) {
    mode = next;
    await page.waitForTimeout(850);
    const before = calls;
    await page.evaluate(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('pageshow')); document.dispatchEvent(new Event('visibilitychange')); });
    await expect.poll(() => calls).toBe(before + 1);
  }
  await refresh('failure');
  await expect(link).toBeVisible();
  await refresh('offline');
  await expect(link).toBeVisible();
  await refresh('held');
  await expect(link).toBeVisible();
  finish();
  await page.getByRole('link', { name: 'Office', exact: true }).click();
  await expect(link).toHaveCount(0);
  mode = 'failure';
  await page.getByRole('link', { name: 'Back to the foyer', exact: true }).click();
  // A new foyer render uses the real server verdict, not the earlier UI mock.
  await expect(link).toHaveCount(0);
  await refresh('allowed');
  await expect(link).toBeVisible();
  await refresh('denied');
  await expect(link).toHaveCount(0);
  await refresh('allowed');
  await expect(link).toBeVisible();
  await page.evaluate(() => {
    const channel = new BroadcastChannel('continental-sign-out');
    channel.postMessage('signed-out'); channel.close();
  });
  await expect(link).toHaveCount(0);
  console.log('PASS: slow/offline/503 checks preserve mounted shortcut; focus events deduplicate; foyer return uses server verdict; denial and cross-tab logout hide it; server still denies anonymous admin access.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  if (server) server.kill();
});
