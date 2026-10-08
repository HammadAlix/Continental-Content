/* eslint-disable @typescript-eslint/no-require-imports -- Real development auth; no production users or product writes. */
const { chromium, expect } = require('@playwright/test');
const { clerkSetup, setupClerkTestingToken } = require('@clerk/testing/playwright');
const { createClerkClient } = require('@clerk/backend');
const { randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const path = require('node:path');
if (!process.env.CLERK_SECRET_KEY?.startsWith('sk_test_')) throw new Error('Development Clerk required.');
const baseURL = 'http://localhost:3022';
const email = `refresh-${randomUUID()}+clerk_test@example.com`;
const client = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
let server, browser;
async function main() {
  server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--port', '3022'], {
    cwd: path.resolve(__dirname, '..'), env: { ...process.env, ADMIN_EMAIL: email, APP_URL: baseURL }, windowsHide: true, stdio: 'ignore',
  });
  let ready = false;
  for (let i = 0; i < 45; i++) {
    if (server.exitCode !== null) throw new Error('Preview stopped.');
    try { if ((await fetch(baseURL + '/sign-in')).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  assert.ok(ready);
  await clerkSetup();
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const owner = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await owner.newPage();
  page.setDefaultTimeout(25000);
  await setupClerkTestingToken({ page });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(baseURL + '/sign-up');
  await page.getByLabel('Email address', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(`Cc!${randomUUID()}Aa9`);
  const [prepared] = await Promise.all([
    page.waitForResponse(r => r.url().includes('/prepare_verification') && r.request().method() === 'POST'),
    page.getByRole('button', { name: 'Continue', exact: true }).click(),
  ]);
  assert.ok(prepared.ok());
  await expect(page.getByText('Verify your email', { exact: true })).toBeVisible();
  await page.getByRole('textbox').first().fill('424242');
  await page.waitForURL('**/account');
  // Force background checks to fail. The link must come from server HTML,
  // not an intercepted positive access response or persistent browser role.
  await page.route('**/api/admin/access', route => route.fulfill({ status: 503, body: '{}' }));
  const link = page.getByRole('link', { name: 'Manage Store', exact: true });
  for (const route of ['/', '/?foyer=1', '/foyer']) {
    const response = await page.goto(baseURL + route, { waitUntil: 'domcontentloaded' });
    const html = await response.text();
    assert.match(html, /<a[^>]+href="\/admin\/store"[^>]*>Manage Store<\/a>/, 'Owner link is in initial HTML');
    assert.match(response.headers()['cache-control'], /private/);
    assert.match(response.headers()['cache-control'], /no-store/);
    await expect(link).toBeVisible();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(link).toBeVisible();
    await expect(page.locator('.navbar-owner-placeholder')).toHaveCount(0);
  }
  console.log('PASS: owner link is present in private initial HTML and survives hard reload on all foyer URLs, even with background checks returning 503.');
  const noJs = await browser.newContext({ javaScriptEnabled: false, storageState: await owner.storageState(), viewport: { width: 1440, height: 900 } });
  const staticPage = await noJs.newPage();
  await staticPage.goto(baseURL + '/?foyer=1');
  await expect(staticPage.getByRole('link', { name: 'Manage Store', exact: true })).toBeVisible();
  console.log('PASS: owner button is visible with JavaScript completely disabled.');
  const guest = await browser.newContext({ javaScriptEnabled: false });
  const guestPage = await guest.newPage();
  for (const route of ['/?foyer=1', '/foyer']) {
    await guestPage.goto(baseURL + route);
    await expect(guestPage.getByRole('link', { name: 'Manage Store', exact: true })).toHaveCount(0);
  }
  assert.equal((await guest.request.get(baseURL + '/api/admin/products')).status(), 403);
  await page.goto(baseURL + '/office');
  await page.getByRole('link', { name: 'Back to the foyer', exact: true }).click();
  await expect(link).toBeVisible();
  await page.goto(baseURL + '/account');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.waitForURL('**/?foyer=1');
  await expect(link).toHaveCount(0);
  await page.reload();
  await expect(link).toHaveCount(0);
  assert.deepEqual(errors, []);
  console.log('PASS: guest cannot see/use owner access; returning from a room is stable; actual signout removes the link before and after reload; no hydration errors.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(async () => {
  await browser?.close();
  server?.kill();
  try {
    const users = await client.users.getUserList({ emailAddress: [email] });
    for (const user of users.data) {
      if (user.emailAddresses.some(entry => entry.emailAddress === email)) await client.users.deleteUser(user.id);
    }
    console.log('Cleanup: removed only the disposable development account; no product data changed.');
  } catch { console.error('Disposable account cleanup requires review.'); process.exitCode = 1; }
});
