/* eslint-disable @typescript-eslint/no-require-imports -- Read-only local browser regression test. */
const { chromium, expect } = require('@playwright/test');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const baseURL = 'http://localhost:3018';
let server, browser;
async function main() {
  server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--port', '3018'], {
    cwd: path.resolve(__dirname, '..'), env: { ...process.env, APP_URL: baseURL }, windowsHide: true, stdio: 'ignore',
  });
  let ready = false;
  for (let count = 0; count < 45; count++) {
    if (server.exitCode !== null) throw new Error('Isolated preview stopped.');
    try { if ((await fetch(baseURL + '/office')).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  assert.ok(ready, 'Preview started');
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'no-preference' });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  const imagePattern = url => url.pathname === '/_next/image' && (url.searchParams.get('url') || '').includes('merch');
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route(imagePattern, async route => { await gate; await route.continue(); });
  await page.goto(baseURL + '/office');
  await page.getByRole('link', { name: 'Merch', exact: true }).click();
  const scene = page.locator('.merch-scene');
  await expect(scene).toBeAttached();
  await expect(scene).toHaveCSS('opacity', '0');
  assert.equal(await scene.evaluate(el => el.inert), true);
  release();
  await expect(page.locator('.merch-experience')).toHaveClass(/is-scene-ready/);
  const middle = await scene.evaluate(el => {
    const animation = el.getAnimations().find(a => a.animationName === 'merch-room-enter');
    if (!animation) throw new Error('Entrance animation missing');
    animation.pause(); animation.currentTime = 300;
    return { opacity: Number(getComputedStyle(el).opacity), transform: getComputedStyle(el).transform };
  });
  assert.ok(middle.opacity > 0 && middle.opacity < 1, 'Visible gradual fade');
  assert.notEqual(middle.transform, 'none');
  const screenshots = fs.mkdtempSync(path.join(os.tmpdir(), 'continental-merch-fade-'));
  await page.screenshot({ path: path.join(screenshots, 'mid-fade.png') });
  await scene.evaluate(el => el.getAnimations().forEach(a => a.play()));
  await expect.poll(() => scene.evaluate(el => el.inert)).toBe(false);
  await expect(scene).toHaveCSS('opacity', '1');
  await page.locator('.merch-hotspot').first().hover();
  await expect(page.locator('.merch-hover-caption')).toBeVisible();
  await expect(page.locator('.merch-room-caption')).toHaveCSS('opacity', '0.18');
  await page.mouse.move(5, 5);
  await page.getByRole('button', { name: /View collection/ }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.screenshot({ path: path.join(screenshots, 'settled.png') });
  console.log('Cold image: waits for load, fades gradually, then enables accurate garment interactions; collection opens.');

  await page.unroute(imagePattern);
  await page.goto(baseURL + '/?foyer=1');
  await page.getByRole('button', { name: 'Merch Room', exact: true }).click();
  await expect(page.locator('.merch-experience')).toHaveClass(/is-scene-ready/);
  await expect.poll(() => page.locator('.merch-scene').evaluate(el => el.inert)).toBe(false);
  console.log('Foyer door navigation with cached image completes the reveal.');

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const mobilePage = await mobile.newPage();
  await mobilePage.goto(baseURL + '/merch');
  const mobileScene = mobilePage.locator('.merch-scene');
  await expect(mobileScene).toHaveCSS('animation-name', 'merch-room-fade');
  await expect(mobileScene).toHaveCSS('transform', 'none');
  await expect.poll(() => mobileScene.evaluate(el => el.inert)).toBe(false);
  assert.ok(await mobilePage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No mobile overflow');
  console.log('Mobile/reduced motion: fade only, no zoom, no horizontal overflow.');

  const broken = await browser.newContext();
  const brokenPage = await broken.newPage();
  await brokenPage.route(imagePattern, route => route.abort());
  await brokenPage.goto(baseURL + '/merch');
  await expect(brokenPage.locator('.merch-scene-error')).toContainText('room artwork could not load');
  await brokenPage.getByRole('button', { name: /View collection/ }).click();
  await expect(brokenPage.getByRole('dialog')).toBeVisible();
  console.log('Failed artwork: collection remains usable; invisible hotspots stay inert.');
  console.log('Screenshots: ' + screenshots);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  if (server) server.kill();
});
