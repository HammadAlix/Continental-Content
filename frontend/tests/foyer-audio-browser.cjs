/* eslint-disable @typescript-eslint/no-require-imports -- Opt-in local browser verification. */
const { chromium, expect } = require('@playwright/test');
const assert = require('node:assert/strict');

const baseURL = process.env.FOYER_TEST_BASE_URL || 'http://127.0.0.1:3107';
if (!['localhost', '127.0.0.1'].includes(new URL(baseURL).hostname)) {
  throw new Error('Run this audio check against a local preview.');
}

async function main() {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.setDefaultTimeout(20000);
    let audioRequests = 0;
    page.on('request', request => { if (request.url().includes('/audio/')) audioRequests++; });
    await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: 'Turn background music on' })).toBeVisible();
    await page.waitForTimeout(1000);
    assert.equal(audioRequests, 0, 'Audio must not download before interaction');
    await page.getByRole('button', { name: 'Turn background music on' }).click();
    await expect(page.getByRole('button', { name: 'Mute background music' })).toHaveText('Sound on');
    await expect.poll(() => page.locator('audio').evaluate(audio => audio.currentTime)).toBeGreaterThan(.2);
    assert.ok(audioRequests > 0);
    assert.equal(await page.locator('audio').evaluate(audio => audio.volume), .25);
    console.log('PASS: original M4A decodes and plays; no audio request before interaction');

    await page.locator('audio').evaluate(audio => { audio.currentTime = audio.duration - .3; });
    await expect.poll(() => page.locator('audio').evaluate(audio => audio.currentTime)).toBeLessThan(3);
    console.log('PASS: audio loops at its end');
    await page.getByRole('button', { name: 'Mute background music' }).click();
    assert.equal(await page.locator('audio').evaluate(audio => audio.paused), true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);
    await page.mouse.click(700, 120);
    assert.equal(await page.locator('audio').evaluate(audio => audio.paused), true);
    await page.getByRole('button', { name: 'Turn background music on' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Mute background music' })).toHaveText('Sound on');
    console.log('PASS: mute persists through reload; keyboard can enable sound');

    await page.evaluate(() => { window.__foyerAudioTest = document.querySelector('audio'); });
    await page.getByRole('link', { name: 'Office', exact: true }).click();
    await page.waitForURL('**/office');
    await expect(page.getByRole('button', { name: 'Mute background music' })).toHaveText('Sound on');
    assert.equal(await page.evaluate(() => window.__foyerAudioTest === document.querySelector('audio')), true);
    assert.equal(await page.locator('audio').evaluate(audio => audio.paused), false);
    await page.getByRole('link', { name: 'Merch', exact: true }).click();
    await page.waitForURL('**/merch');
    await expect(page.getByRole('button', { name: 'Mute background music' })).toHaveText('Sound on');
    assert.equal(await page.evaluate(() => window.__foyerAudioTest === document.querySelector('audio')), true);
    await expect(page.locator('.merch-bag-button')).toBeVisible();
    assertNoOverlap(await page.locator('.foyer-sound').boundingBox(), await page.locator('.merch-bag-button').boundingBox());
    console.log('PASS: Office and Merch preserve one playing audio element; desktop bag stays clear');
    await page.getByRole('link', { name: 'Membership', exact: true }).click();
    await page.waitForURL('**/membership');
    await expect(page.locator('.foyer-sound')).toBeHidden();
    await expect.poll(() => page.locator('audio').evaluate(audio => audio.paused)).toBe(true);
    await page.goBack({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: 'Mute background music' })).toHaveText('Sound on');
    console.log('PASS: pricing is silent; returning to a room resumes the existing player');

    await page.goto(`${baseURL}/foyer`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: 'Turn background music on' })).toBeVisible();
    await page.getByRole('button', { name: 'Turn background music on' }).click();
    await expect(page.getByRole('button', { name: 'Mute background music' })).toHaveText('Sound on');
    console.log('PASS: legacy foyer supports the same audio control');

    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await mobile.goto(baseURL, { waitUntil: 'domcontentloaded' });
    await expect(mobile.getByRole('button', { name: 'Turn background music on' })).toBeVisible();
    await mobile.waitForTimeout(1000);
    await mobile.getByRole('button', { name: 'Menu', exact: true }).tap();
    await expect(mobile.getByRole('button', { name: 'Mute background music' })).toHaveText('Sound on');
    const box = await mobile.locator('.foyer-sound').boundingBox();
    assert.ok(box.width >= 44 && box.height >= 44);
    assert.ok(box.x >= 0 && box.x + box.width <= 390 && box.y + box.height <= 844);
    await mobile.getByRole('button', { name: 'Mute background music' }).tap();
    assert.equal(await mobile.locator('audio').evaluate(audio => audio.paused), true);
    console.log('PASS: mobile first interaction starts sound; accessible control fits and mutes');
    await mobile.getByRole('link', { name: 'Office', exact: true }).tap();
    await mobile.waitForURL('**/office');
    await expect(mobile.getByRole('button', { name: 'Turn background music on' })).toBeVisible();
    assert.equal(await mobile.locator('audio').evaluate(audio => audio.paused), true);
    assertNoOverlap(await mobile.locator('.foyer-sound').boundingBox(), await mobile.locator('.back-to-foyer').boundingBox());
    await mobile.getByRole('button', { name: 'Menu', exact: true }).tap();
    await mobile.getByRole('link', { name: 'Merch', exact: true }).tap();
    await mobile.waitForURL('**/merch');
    await expect(mobile.getByRole('button', { name: 'Turn background music on' })).toBeVisible();
    await expect(mobile.locator('.merch-bag-button')).toBeVisible();
    assertNoOverlap(await mobile.locator('.foyer-sound').boundingBox(), await mobile.locator('.back-to-foyer').boundingBox());
    assertNoOverlap(await mobile.locator('.foyer-sound').boundingBox(), await mobile.locator('.merch-bag-button').boundingBox());
    console.log('PASS: mute persists across mobile rooms; sound control clears bag and return links');
    if (process.env.FOYER_TEST_SCREENSHOT) {
      await mobile.screenshot({ path: process.env.FOYER_TEST_SCREENSHOT });
    }
  } finally {
    await browser.close();
  }
}
function assertNoOverlap(a, b) {
  assert.ok(a && b, 'Both controls must be rendered');
  assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y,
    'Music control must not overlap room controls');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
