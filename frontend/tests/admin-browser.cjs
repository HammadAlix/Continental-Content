/* eslint-disable @typescript-eslint/no-require-imports -- Opt-in integration test, localhost and development Clerk only. */
const { chromium, expect } = require('@playwright/test');
const { clerkSetup, clerk, setupClerkTestingToken } = require('@clerk/testing/playwright');
const { createClerkClient } = require('@clerk/backend');
const { neon } = require('@neondatabase/serverless');
const { randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const sharp = require('sharp');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

if (!process.env.CLERK_SECRET_KEY?.startsWith('sk_test_') || !process.env.DATABASE_URL) throw new Error('Development credentials required.');
const baseURL = 'http://localhost:3017';
const email = `admin-${randomUUID()}+clerk_test@example.com`;
const customerEmail = `customer-${randomUUID()}+clerk_test@example.com`;
const productId = `admin-e2e-${randomUUID()}`;
const password = `Cc!${randomUUID()}Aa9`;
const client = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
const sql = neon(process.env.DATABASE_URL);
const users = [];
let server, browser;
async function main() {
  // Override only the isolated child process, never the real owner's .env.local.
  server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--port', '3017'], {
    cwd: path.resolve(__dirname, '..'), windowsHide: true, stdio: 'ignore',
    env: { ...process.env, ADMIN_EMAIL: email, APP_URL: baseURL },
  });
  let ready = false;
  for (let count = 0; count < 90; count++) {
    if (server.exitCode !== null) throw new Error('Isolated server stopped.');
    try { if ((await fetch(baseURL + '/sign-in')).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  if (!ready) throw new Error('Isolated server did not become ready.');
  await clerkSetup();
  browser = await chromium.launch({ channel: process.env.AUTH_TEST_BROWSER || 'msedge', headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(25000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await setupClerkTestingToken({ page });
  async function signUp(address) {
    await page.goto(baseURL + '/sign-up');
    await page.getByLabel('Email address', { exact: true }).fill(address);
    await page.getByLabel('Password', { exact: true }).fill(password);
    const [prepared] = await Promise.all([
      page.waitForResponse(r => r.url().includes('/prepare_verification') && r.request().method() === 'POST'),
      page.getByRole('button', { name: 'Continue', exact: true }).click(),
    ]);
    if (!prepared.ok()) throw new Error('Fixture verification preparation failed.');
    await expect(page.getByText('Verify your email', { exact: true })).toBeVisible();
    await page.getByRole('textbox').first().fill('424242');
    await page.waitForURL('**/account');
    const found = await client.users.getUserList({ emailAddress: [address] });
    for (const user of found.data) users.push({ id: user.id, address });
  }
  await signUp(email);
  await expect(page.getByText('Email verified', { exact: true })).toBeVisible();
  await page.goto(baseURL + '/?foyer=1');
  await expect(page.getByRole('link', { name: 'Manage Store', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Manage Store', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Manage Store', exact: true }).click();
  await expect(page).toHaveURL(baseURL + '/admin/store');
  await expect(page.getByRole('link', { name: 'Back to the foyer', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to Theatre', exact: true })).toHaveCount(0);
  await page.goto(baseURL + '/account/admin');
  await expect(page).toHaveURL(baseURL + '/admin/store');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: 'Add product', exact: true }).click();
  await page.getByLabel('Product ID (cannot change after creation)').fill(productId);
  await page.getByLabel('Name', { exact: true }).fill('Admin integration fixture');
  await page.getByLabel('Short category label').fill('Test hoodie');
  await page.getByLabel('Price (USD)').fill('62.99');
  const photo = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#d4af37' } }).png().toBuffer();
  await page.getByLabel('Product photo', { exact: false }).setInputFiles({ name: 'fixture.png', mimeType: 'image/png', buffer: photo });
  await page.getByRole('button', { name: 'Save product', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Saved.');
  await expect(page.getByRole('button', { name: 'Add product', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: /Admin integration fixture/ }).click();
  await expect(page.getByLabel('Price (USD)')).toHaveValue('62.99');
  const request = (method, body, origin = baseURL) => page.evaluate(async ({ method, body, origin }) => {
    const response = await fetch('/api/admin/products', { method, headers: { 'Content-Type': 'application/json', Origin: origin },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  }, { method, body, origin });
  const listing = await request('GET');
  const fixture = listing.body.products.find(p => p.id === productId);
  if (!fixture || fixture.published || fixture.price !== 6299) throw new Error('Draft did not persist.');
  const publicContext = await browser.newContext();
  const publicPage = await publicContext.newPage();
  if ((await publicContext.request.get(baseURL + '/api/admin/products')).status() !== 403) throw new Error('Anonymous admin access allowed.');
  if ((await publicContext.request.get(baseURL + fixture.imageUrl)).status() !== 404) throw new Error('Draft image leaked.');
  await page.getByLabel('Published — visible and available for new checkouts').check();
  await page.getByRole('button', { name: 'Save product', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Saved.');
  if ((await request('POST', fixture)).status !== 409) throw new Error('Stale edit accepted.');
  const crossOrigin = await page.context().request.post(baseURL + '/api/admin/products', { headers: { origin: 'https://evil.example' }, data: fixture });
  if (crossOrigin.status() !== 403) throw new Error('Cross-origin write accepted.');
  await publicPage.goto(baseURL + '/merch');
  await publicPage.getByRole('button', { name: /View collection/ }).click();
  await expect(publicPage.getByRole('button', { name: /Test hoodie Admin integration fixture/ })).toBeVisible();
  const img = await publicContext.request.get(baseURL + fixture.imageUrl);
  if (img.status() !== 200 || img.headers()['content-type'] !== 'image/webp') throw new Error('Processed photo unavailable.');
  const changedPrice = await publicContext.request.post(baseURL + '/api/checkout', {
    headers: { origin: baseURL }, data: { attemptId: randomUUID(), cart: [{ productId, size: 'S', quantity: 1 }], expectedSubtotal: 1 },
  });
  if (changedPrice.status() !== 409) throw new Error('Checkout did not reject the stale client price.');
  // Mock only the paid receipt response: no Stripe transaction is made by this test.
  const bag = [{ productId, size: 'S', quantity: 1 }];
  await publicPage.evaluate(bag => {
    localStorage.setItem('continental-merch-preview-v1', JSON.stringify(bag));
    sessionStorage.setItem('merch-purchase:cs_test_fixture', JSON.stringify(bag));
  }, bag);
  await publicPage.route('**/api/checkout/status', route => route.fulfill({ json: {
    status: 'paid', reference: 'TEST', total: 7299, shipping: 1000,
    items: [{ productId, name: 'Admin integration fixture', size: 'S', quantity: 1, unitAmount: 6299 }],
  } }));
  await publicPage.goto(baseURL + '/merch/checkout/success?session_id=cs_test_fixture');
  await expect(publicPage.getByRole('heading', { name: 'Your test order is confirmed.' })).toBeVisible();
  if (await publicPage.evaluate(() => localStorage.getItem('continental-merch-preview-v1')) !== null) throw new Error('New-product purchased bag was not cleared.');
  await page.getByRole('button', { name: /Admin integration fixture/ }).click();
  const preview = page.getByAltText('Product photo preview');
  await preview.scrollIntoViewIfNeeded();
  await expect.poll(() => preview.evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
  await page.getByLabel('Published — visible and available for new checkouts').uncheck();
  await page.getByRole('button', { name: 'Save product', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Saved.');
  await expect(page.getByRole('button', { name: 'Add product', exact: true })).toBeEnabled();
  if ((await publicContext.request.get(baseURL + fixture.imageUrl)).status() !== 404) throw new Error('Hidden image remained public.');
  await expect(page.getByRole('button', { name: /Admin integration fixture/ })).toContainText('Hidden / draft');
  await page.getByRole('button', { name: /Admin integration fixture/ }).click();
  const screenshotDir = fs.mkdtempSync(path.join(os.tmpdir(), 'continental-admin-'));
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error('Admin horizontal overflow.');
    await page.screenshot({ path: path.join(screenshotDir, `admin-${width}.png`), fullPage: true });
  }
  console.log('Admin screenshots:', screenshotDir);
  page.on('dialog', dialog => dialog.accept());
  await page.goto(baseURL + '/account');
  await clerk.signOut({ page });
  await signUp(customerEmail);
  await expect(page.getByRole('link', { name: 'Manage Store' })).toHaveCount(0);
  if ((await request('GET')).status !== 403 || (await request('POST', fixture)).status !== 403) throw new Error('Customer gained admin access.');
  await page.goto(baseURL + '/account/admin');
  await expect(page).toHaveURL(baseURL + '/account');
  await page.goto(baseURL + '/admin/store');
  await expect(page).toHaveURL(baseURL + '/account');
  const accessResponse = page.waitForResponse(r => r.url().endsWith('/api/admin/access'));
  await page.goto(baseURL + '/?foyer=1');
  if ((await (await accessResponse).json()).allowed !== false) throw new Error('Customer foyer owner access allowed.');
  await expect(page.getByRole('link', { name: 'Manage Store' })).toHaveCount(0);
  if (errors.length) throw new Error('Browser runtime errors occurred.');
  console.log('PASS: verified owner, create/photo/edit/publish/hide, stale-write protection, origin checks, anonymous/customer denial, new-product receipt cleanup and mobile editor layout.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(async () => {
  await browser?.close();
  server?.kill();
  // Delete only the exact randomly named fixtures created by this test.
  try {
    await sql.transaction([
      sql`delete from merch_product_audit where product_id = ${productId}`,
      sql`delete from merch_products where id = ${productId}`,
    ]);
    for (const user of users) {
      const stored = await client.users.getUser(user.id);
      if (stored.emailAddresses.some(e => e.emailAddress === user.address)) await client.users.deleteUser(user.id);
    }
  } catch { console.error('Fixture cleanup needs checking; no broad deletion attempted.'); process.exitCode = 1; }
});
