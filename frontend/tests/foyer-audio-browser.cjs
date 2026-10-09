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
    await expect(page.getByRole('button', { name: 'Turn foyer music on' })).toBeVisible();
    await page.waitForTimeout(1000);
    assert.equal(audioRequests, 0, 'Audio must not download before interaction');
    await page.getByRole('button', { name: 'Turn foyer music on' }).click();
    await expect(page.getByRole('button', { name: 'Mute foyer music' })).toHaveText('Sound on');
    await expect.poll(() => page.locator('audio').evaluate(audio => audio.currentTime)).toBeGreaterThan(.2);
    assert.ok(audioRequests > 0);
    assert.equal(await page.locator('audio').evaluate(audio => audio.volume), .25);
    console.log('PASS: original M4A decodes and plays; no audio request before interaction');

    await page.locator('audio').evaluate(audio => { audio.currentTime = audio.duration - .3; });
    await expect.poll(() => page.locator('audio').evaluate(audio => audio.currentTime)).toBeLessThan(3);
    console.log('PASS: audio loops at its end');
    await page.getByRole('button', { name: 'Mute foyer music' }).click();
    assert.equal(await page.locator('audio').evaluate(audio => audio.paused), true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);
    await page.mouse.click(700, 120);
    assert.equal(await page.locator('audio').evaluate(audio => audio.paused), true);
    await page.getByRole('button', { name: 'Turn foyer music on' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Mute foyer music' })).toHaveText('Sound on');
    console.log('PASS: mute persists through reload; keyboard can enable sound');

    await page.evaluate(() => { window.__foyerAudioTest = document.querySelector('audio'); });
    await page.getByRole('link', { name: 'Office', exact: true }).click();
    await page.waitForURL('**/office');
    await expect(page.locator('.foyer-sound')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => window.__foyerAudioTest?.paused)).toBe(true);
    assert.equal(await page.locator('audio').count(), 0);
    console.log('PASS: client-side room navigation removes control and stops previous audio');

    await page.goto(`${baseURL}/foyer`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: 'Turn foyer music on' })).toBeVisible();
    await page.getByRole('button', { name: 'Turn foyer music on' }).click();
    await expect(page.getByRole('button', { name: 'Mute foyer music' })).toHaveText('Sound on');
    console.log('PASS: legacy foyer supports the same audio control');

    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await mobile.goto(baseURL, { waitUntil: 'domcontentloaded' });
    await expect(mobile.getByRole('button', { name: 'Turn foyer music on' })).toBeVisible();
    await mobile.waitForTimeout(1000);
    await mobile.getByRole('button', { name: 'Menu', exact: true }).tap();
    await expect(mobile.getByRole('button', { name: 'Mute foyer music' })).toHaveText('Sound on');
    const box = await mobile.locator('.foyer-sound').boundingBox();
    assert.ok(box.width >= 44 && box.height >= 44);
    assert.ok(box.x >= 0 && box.x + box.width <= 390 && box.y + box.height <= 844);
    await mobile.getByRole('button', { name: 'Mute foyer music' }).tap();
    assert.equal(await mobile.locator('audio').evaluate(audio => audio.paused), true);
    console.log('PASS: mobile first interaction starts sound; accessible control fits and mutes');
    if (process.env.FOYER_TEST_SCREENSHOT) {
      await mobile.getByRole('button', { name: 'Menu', exact: true }).tap();
      await mobile.screenshot({ path: process.env.FOYER_TEST_SCREENSHOT });
    }
  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
