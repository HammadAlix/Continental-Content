/* eslint-disable @typescript-eslint/no-require-imports -- Standalone opt-in E2E runner. */
const { chromium, expect } = require('@playwright/test');
const { clerkSetup, setupClerkTestingToken } = require('@clerk/testing/playwright');
const { createClerkClient } = require('@clerk/backend');
const { randomUUID } = require('node:crypto');

// Never run this against a production instance or send a message to a real user.
const baseURL = process.env.AUTH_TEST_BASE_URL || 'http://localhost:3000';
const target = new URL(baseURL);
if (!['localhost', '127.0.0.1'].includes(target.hostname) || !process.env.CLERK_SECRET_KEY?.startsWith('sk_test_')) {
  throw new Error('This test requires localhost and Clerk development credentials.');
}
const email = `continental-${randomUUID()}+clerk_test@example.com`;
const password = `Cc!${randomUUID()}Aa9`;
const nextPassword = `Cc!${randomUUID()}Bb8`;
const client = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });

async function main() {
  await clerkSetup();
  const browser = await chromium.launch({ channel: process.env.AUTH_TEST_BROWSER || 'msedge', headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(20000);
  await setupClerkTestingToken({ page });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto(`${baseURL}/account`);
    await page.waitForURL('**/sign-in');
    console.log('PASS: anonymous account requests redirect to sign-in');
    await page.goto(`${baseURL}/theatre`);
    await page.waitForURL(/\/membership(?:\?|$)/);
    await expect(page.getByText('$5.99 USD / month', { exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Sign in', exact: true }).click();
    await page.waitForURL('**/sign-in?next=membership');
    await expect(page.getByRole('heading', { name: 'Welcome back.', exact: true })).toBeVisible();
    await expect(page.locator('.room-backdrop')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Sign up', exact: true })).toHaveAttribute('href', '/sign-up?next=membership');
    console.log('PASS: anonymous Theatre visitors see pricing before sign-in; auth preserves membership destination');

    await page.goto(`${baseURL}/sign-up`);
    await page.getByLabel('Email address', { exact: true }).fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    const [signupCodeResponse] = await Promise.all([
      page.waitForResponse(r => r.url().includes('/prepare_verification') && r.request().method() === 'POST'),
      page.getByRole('button', { name: 'Continue', exact: true }).click(),
    ]);
    if (!signupCodeResponse.ok()) throw new Error('Sign-up verification code request failed.');
    await expect(page.getByText('Verify your email', { exact: true })).toBeVisible();
    console.log('PASS: sign-up requires email verification');
    // Clerk reserves this OTP for +clerk_test addresses in development only.
    await page.getByRole('textbox').first().fill('424242');
    await page.waitForURL('**/account');
    await expect(page.getByText('Email verified', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Manage membership', exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Manage membership', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Manage membership', exact: true })).toBeVisible();
    await expect(page.getByText('$5.99 USD / month', { exact: true })).toBeVisible();
    await expect(page.getByText(/FairPlay/i)).toHaveCount(0);
    await expect(page.locator('.room-backdrop')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Screenings', exact: true })).toHaveCount(0);
    await page.goto(`${baseURL}/theatre`);
    await page.waitForURL(/\/membership(?:\?|$)/);
    await expect(page.locator('.membership-plan')).toBeVisible();
    console.log('PASS: verified but unpaid account cannot enter the Theatre or see the video library');
    await page.setViewportSize({ width: 390, height: 844 });
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error('Theatre mobile overflow');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${baseURL}/account`);
    await page.reload();
    await expect(page.getByText('Email verified', { exact: true })).toBeVisible();
    console.log('PASS: verified account persists; Theatre price, setup warning and responsive layout verified');

    await page.getByRole('link', { name: 'Account settings', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Account settings', exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Back to your account', exact: true }).click();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.waitForURL('**/?foyer=1');
    await page.goto(`${baseURL}/account`);
    await page.waitForURL('**/sign-in');
    console.log('PASS: settings and sign-out; protected account cannot be reopened');
    await page.goto(`${baseURL}/sign-in?next=membership`);

    await page.getByLabel('Email address', { exact: true }).fill(email);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.waitForURL('**/membership');
    await expect(page.getByText('$5.99 USD / month', { exact: true })).toBeVisible();
    await page.goto(`${baseURL}/account`);
    console.log('PASS: password sign-in returns to membership pricing, not the paid Theatre interior');
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.waitForURL('**/?foyer=1');

    await page.goto(`${baseURL}/sign-in`);
    await page.getByLabel('Email address', { exact: true }).fill(email);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByRole('link', { name: /forgot.*password/i }).click();
    const [resetCodeResponse] = await Promise.all([
      page.waitForResponse(r => r.url().includes('/prepare_first_factor') && r.request().method() === 'POST'),
      page.getByText('Reset your password', { exact: true }).click(),
    ]);
    if (!resetCodeResponse.ok()) throw new Error(`Reset code request failed: ${resetCodeResponse.status()}`);
    await page.getByRole('textbox').first().fill('424242');
    await page.getByLabel('New password', { exact: true }).waitFor();
    await page.getByLabel('New password', { exact: true }).fill(nextPassword);
    await page.getByLabel('Confirm password', { exact: true }).fill(nextPassword);
    await page.getByLabel('Sign out of all other devices').check();
    await page.getByRole('button', { name: 'Reset Password', exact: true }).click();
    await page.waitForURL('**/account');
    console.log('PASS: password recovery verifies email and changes the password');
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.waitForURL('**/?foyer=1');
    await page.goto(`${baseURL}/sign-in`);
    await page.getByLabel('Email address', { exact: true }).fill(email);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByLabel('Password', { exact: true }).fill(password);
    const [oldPasswordResponse] = await Promise.all([
      page.waitForResponse(r => r.url().includes('/attempt_first_factor') && r.request().method() === 'POST'),
      page.getByRole('button', { name: 'Continue', exact: true }).click(),
    ]);
    if (oldPasswordResponse.ok()) throw new Error('Old password was accepted after reset');
    await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
    await page.getByLabel('Password', { exact: true }).fill(nextPassword);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.waitForURL('**/account');
    console.log('PASS: old password rejected; new password signs in');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('link', { name: 'Account settings', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Account settings', exact: true })).toBeVisible();
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error('Mobile account settings overflow');
    console.log('PASS: account settings on mobile');
    if (errors.length) throw new Error(errors.join('\n'));
  } catch (error) {
    console.error('SCREEN:', (await page.locator('body').innerText()).replaceAll(email, '[test email]').slice(0,3000));
    throw error;
  } finally {
    await browser.close();
    const { data } = await client.users.getUserList({ emailAddress: [email] });
    for (const user of data) {
      if (user.emailAddresses.some(e => e.emailAddress === email)) await client.users.deleteUser(user.id);
    }
    console.log('Cleanup: removed only this run\'s disposable test account; no real email sent.');
  }
}

main().catch(error => {
  console.error(String(error.message).replaceAll(password, '[password]').replaceAll(nextPassword, '[password]').replaceAll(email, '[test email]'));
  process.exitCode = 1;
});
