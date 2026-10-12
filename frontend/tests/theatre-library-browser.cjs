/* eslint-disable @typescript-eslint/no-require-imports -- Opt-in local browser test with disposable development account and test payment. */
const { chromium, expect } = require('@playwright/test');
const { clerkSetup, setupClerkTestingToken } = require('@clerk/testing/playwright');
const { createClerkClient } = require('@clerk/backend');
const Stripe = require('stripe');
const { neon } = require('@neondatabase/serverless');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const baseURL = process.env.THEATRE_TEST_BASE_URL || 'http://localhost:3000';
if (new URL(baseURL).hostname !== 'localhost') throw new Error('Localhost browser tests only.');
if (!process.env.CLERK_SECRET_KEY?.startsWith('sk_test_') || !process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_')) throw new Error('Development/test keys required.');
const client = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { maxNetworkRetries: 0, timeout: 20000 });
const sql = neon(process.env.DATABASE_URL);
const fixture = `library-${randomUUID()}`;
const email = `${fixture}+clerk_test@example.com`, password = `Cc!${randomUUID()}Aa9`;
let user, customer, product, subscription, browser;
let subscriptionCancelled = false;
async function main() {
  user = await client.users.createUser({ emailAddress: [email], password });
  assert.equal(user.emailAddresses[0].verification.status, 'verified');
  await clerkSetup();
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(30000);
  await setupClerkTestingToken({ page });
  await page.goto(baseURL + '/sign-in');
  await page.waitForFunction(() => window.Clerk?.loaded);
  // Official single-use sign-in token, only for the disposable verified dev account.
  // Keeps this UI test independent of OTP/new-device challenges; app authorization stays real.
  const ticket = await client.signInTokens.createSignInToken({ userId: user.id, expiresInSeconds: 60 });
  await page.evaluate(async token => {
    const attempt = await window.Clerk.client.signIn.create({ strategy: 'ticket', ticket: token });
    if (attempt.status !== 'complete') throw new Error('Fixture sign-in incomplete');
    await window.Clerk.setActive({ session: attempt.createdSessionId });
  }, ticket.token);
  const metadata = { integration: 'continental-theatre-v1', userId: user.id, fixture };
  customer = await stripe.customers.create({ metadata, payment_method: 'pm_card_visa', invoice_settings: { default_payment_method: 'pm_card_visa' } });
  product = await stripe.products.create({ name: 'Disposable Theatre UI test', metadata });
  subscription = await stripe.subscriptions.create({ customer: customer.id, metadata,
    items: [{ price_data: { product: product.id, currency: 'usd', unit_amount: 599, recurring: { interval: 'month' } } }], expand: ['latest_invoice'] });
  assert.equal(subscription.latest_invoice.status, 'paid');
  await sql`insert into theatre_members (user_id,customer_id,checkout_attempt) values (${user.id},${customer.id},${randomUUID()})`;
  // The application independently retrieves and validates the actual paid Stripe subscription before access.
  await sql`insert into theatre_subscriptions (id,user_id,customer_id,status) values (${subscription.id},${user.id},${customer.id},'active') on conflict (id) do nothing`;
  // Validate and persist real paid state once before exercising the warm navigation path.
  const verified = await page.request.get(baseURL + '/api/theatre/membership');
  assert.equal(verified.status(), 200);
  assert.equal((await verified.json()).active, true);
  let thumbnailRequests = 0, accessRequests = 0;
  page.on('request', request => {
    if (request.url().includes('/api/theatre/thumbnails')) thumbnailRequests++;
    if (request.url().includes('/api/theatre/membership?view=access')) accessRequests++;
  });
  const membershipStart = Date.now();
  const offer = await page.goto(baseURL + '/membership', { waitUntil: 'domcontentloaded' });
  const offerHtml = await offer.text();
  assert.match(offerHtml, /Enter Theatre/);
  assert.doesNotMatch(offerHtml, /Checking your membership/);
  await expect(page.getByRole('link', { name: 'Enter Theatre', exact: true })).toBeVisible();
  console.log('PASS: Membership button is ready in initial HTML. Warm page navigation: ' + (Date.now() - membershipStart) + 'ms.');
  const theatreStart = Date.now();
  const screeningPage = await page.goto(baseURL + '/theatre', { waitUntil: 'domcontentloaded' });
  assert.match(screeningPage.headers()['cache-control'], /no-store|no-cache/);
  if (process.env.THEATRE_TEST_PRODUCTION === 'true') assert.match(screeningPage.headers()['cache-control'], /private/);
  assert.match(await screeningPage.text(), /<img[^>]+src="https:\/\/image\.mux\.com\//);
  const cards = page.locator('.theatre-card');
  assert.ok(await cards.count() >= 2, 'Recovered upload plus existing sample are listed');
  const demo = page.getByRole('button', { name: 'Watch DRM upload test.', exact: true });
  await expect(demo).toBeVisible();
  await expect(page.locator('.theatre-card-description').first()).toBeVisible();
  await expect.poll(() => page.locator('.theatre-card-poster img').evaluateAll(images => images.length >= 2 && images.every(img => img.complete && img.naturalWidth > 0)), { timeout: 30000 }).toBe(true);
  assert.equal(thumbnailRequests, 0, 'Initial images must not wait for a thumbnail API round trip');
  assert.equal(accessRequests, 0, 'Server-checked pages must not repeat membership checks on mount');
  console.log('PASS: signed images in initial HTML; zero initial thumbnail/membership API calls. Theatre navigation + image load: ' + (Date.now() - theatreStart) + 'ms.');
  const screenshots = fs.mkdtempSync(path.join(os.tmpdir(), 'continental-theatre-library-'));
  await page.screenshot({ path: path.join(screenshots, 'desktop.png'), fullPage: true });
  console.log('PASS: recovered dashboard upload is listed; protected thumbnails load with real Mux signatures; descriptions and titles visible.');
  const playbackResponse = page.waitForResponse(r => r.url().includes('/api/theatre/playback/') && r.request().method() === 'POST');
  await demo.click();
  const playback = await playbackResponse;
  assert.equal(playback.status(), 200);
  const payload = await playback.json();
  await expect(page.locator('dialog.theatre-player-dialog[open]')).toBeVisible();
  await expect(page.locator('mux-player')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Close video', exact: true })).toBeFocused();
  await page.screenshot({ path: path.join(screenshots, 'player.png'), fullPage: true });
  await page.getByRole('button', { name: 'Close video', exact: true }).click();
  await expect(page.locator('dialog.theatre-player-dialog[open]')).toHaveCount(0);
  await expect(page.locator('mux-player')).toHaveCount(0);
  await expect(demo).toBeFocused();
  console.log('PASS: video card opens protected player; X closes/unmounts it and restores keyboard focus.');
  // UI-only delayed-response race: keep real auth/thumbnail/DRM checks untouched.
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  await page.route('**/api/theatre/playback/*', async route => {
    await pending;
    try { await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) }); } catch { /* Close aborts the request. */ }
  });
  await demo.click();
  await expect(page.getByText('Opening your screening…', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close video', exact: true }).click();
  release();
  await page.waitForTimeout(400);
  await expect(page.locator('dialog.theatre-player-dialog[open]')).toHaveCount(0);
  await expect(page.locator('mux-player')).toHaveCount(0);
  await page.unroute('**/api/theatre/playback/*');
  await page.route('**/api/theatre/playback/*', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
  await demo.click();
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  assert.equal(new URL(page.url()).pathname, '/theatre');
  await page.keyboard.press('Escape');
  await expect(page.locator('dialog.theatre-player-dialog[open]')).toHaveCount(0);
  console.log('PASS: closing during loading prevents late reopening; temporary playback failures stay closeable; Escape works.');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.ok(await page.evaluate(() => document.querySelector('.back-to-foyer').getBoundingClientRect().top >= document.querySelector('.theatre-library').getBoundingClientRect().bottom), 'Foyer link must not overlap video cards');
  await page.screenshot({ path: path.join(screenshots, 'mobile.png'), fullPage: true });
  await demo.click();
  await expect(page.getByRole('button', { name: 'Close video', exact: true })).toBeInViewport();
  await page.getByRole('button', { name: 'Close video', exact: true }).click();
  assert.equal(await page.evaluate(() => document.body.style.overflow), '');
  console.log('PASS: mobile cards fit; close control is visible; scrolling restored. Screenshots: ' + screenshots);
  await page.unroute('**/api/theatre/playback/*');
  assert.equal((await (await page.request.get(baseURL + '/api/theatre/membership')).json()).active, true);
  await stripe.subscriptions.cancel(subscription.id);
  subscriptionCancelled = true;
  const videoId = await sql`select id from theatre_videos where title='DRM upload test.' and published=true`;
  assert.ok(videoId[0]);
  const revoked = await page.request.post(baseURL + '/api/theatre/playback/' + encodeURIComponent(videoId[0].id), { headers: { origin: baseURL } });
  assert.equal(revoked.status(), 403, 'Fresh video authorization must reject cancellation even after a positive navigation snapshot');
  assert.equal((await (await page.request.get(baseURL + '/api/theatre/membership?view=access')).json()).active, false);
  console.log('PASS: real test cancellation immediately blocks new playback despite the earlier positive navigation snapshot.');
}
main().catch(error => { console.error('Theatre UI test failed: ' + error.message); process.exitCode = 1; }).finally(async () => {
  await browser?.close();
  try {
    user ||= (await client.users.getUserList({ emailAddress: [email] })).data.find(u => u.emailAddresses.some(e => e.emailAddress === email));
    if (subscription && !subscriptionCancelled) await stripe.subscriptions.cancel(subscription.id);
    if (customer) await stripe.customers.del(customer.id);
    if (product) await stripe.products.update(product.id, { active: false });
    if (user) {
      await sql`delete from theatre_subscriptions where user_id=${user.id}`;
      await sql`delete from theatre_members where user_id=${user.id}`;
      await client.users.deleteUser(user.id);
    }
    console.log('Cleanup: only disposable test account/payment fixtures removed; videos and existing members unchanged.');
  } catch { console.error('Disposable test fixture cleanup requires review.'); process.exitCode = 1; }
});
