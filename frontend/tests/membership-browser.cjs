/* eslint-disable @typescript-eslint/no-require-imports -- Local browser verification. */
const { chromium, expect } = require('@playwright/test');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const baseURL = 'http://localhost:3019';
let server, browser;
async function main() {
  server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--port', '3019'], {
    cwd: path.resolve(__dirname, '..'), env: { ...process.env, APP_URL: baseURL, THEATRE_ENABLED: 'false' }, windowsHide: true, stdio: 'ignore',
  });
  let ready = false;
  for (let attempt = 0; attempt < 45; attempt++) {
    if (server.exitCode !== null) throw new Error('Isolated preview stopped.');
    try { if ((await fetch(baseURL + '/membership')).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  assert.ok(ready);
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let checkoutRequests = 0;
  page.on('request', request => { if (request.url().includes('/api/theatre/checkout')) checkoutRequests++; });
  await page.goto(baseURL + '/theatre');
  await page.waitForURL(/\/membership\?notice=setup/);
  await expect(page.getByText('$5.99 USD / month', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Membership opens soon' })).toBeDisabled();
  await expect(page.locator('mux-player, .room-backdrop, .theatre-library')).toHaveCount(0);
  const screenshots = fs.mkdtempSync(path.join(os.tmpdir(), 'continental-membership-'));
  await page.screenshot({ path: path.join(screenshots, 'desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: path.join(screenshots, 'mobile.png'), fullPage: true });
  await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toHaveAttribute('href', '/sign-in?next=membership');
  await page.getByRole('link', { name: 'Sign in', exact: true }).click();
  await page.waitForURL('**/sign-in?next=membership');
  await expect(page.getByRole('link', { name: 'Sign up', exact: true })).toHaveAttribute('href', '/sign-up?next=membership');
  await page.goto(baseURL + '/account/theatre');
  await page.waitForURL('**/sign-in?next=billing');
  await page.goto(baseURL + '/?foyer=1');
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('link', { name: 'Membership', exact: true }).click();
  await expect(page.locator('.membership-plan')).toBeVisible();
  assert.equal(checkoutRequests, 0, 'Browsing never creates Stripe checkout');
  assert.deepEqual(errors, []);
  console.log('PASS: public offer, locked door redirect, disabled checkout, login return, legacy billing link, mobile menu and responsive layout.');
  console.log('Screenshots: ' + screenshots);
  if (process.argv.includes('--auth')) {
    const child = spawn(process.execPath, ['tests/auth-browser.cjs'], {
      cwd: path.resolve(__dirname, '..'), env: { ...process.env, AUTH_TEST_BASE_URL: baseURL }, windowsHide: true, stdio: 'inherit',
    });
    const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
    assert.equal(code, 0, 'Real Clerk regression check');
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  if (server) server.kill();
});
