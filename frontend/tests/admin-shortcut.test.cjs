/* eslint-disable @typescript-eslint/no-require-imports -- Isolated UI-state regression tests. */
const test = require('node:test');
const assert = require('node:assert/strict');
const createLoader = require('./office-loader.cjs');

test('admin shortcut deduplicates checks, survives transient errors, and clears on confirmed denial/logout', async () => {
  const originalFetch = global.fetch;
  const originalNow = Date.now;
  let time = 10000;
  Date.now = () => time;
  let finish;
  let calls = 0;
  global.fetch = () => { calls++; return new Promise(resolve => { finish = resolve; }); };
  try {
    const state = createLoader()('lib/admin-shortcut.ts').createAdminShortcut(false);
    assert.equal(state.adminShortcutServerSnapshot(), 'denied');
    assert.equal(state.adminShortcutSnapshot(), 'denied');
    const first = state.refreshAdminShortcut();
    assert.equal(first, state.refreshAdminShortcut());
    assert.equal(calls, 1);
    finish(Response.json({ allowed: true })); await first;
    assert.equal(state.adminShortcutSnapshot(), 'allowed');
    time += 1000;
    const failed = state.refreshAdminShortcut();
    assert.equal(state.adminShortcutSnapshot(), 'allowed');
    finish(new Response(null, { status: 503 })); await failed;
    assert.equal(state.adminShortcutSnapshot(), 'allowed');
    time += 1000;
    global.fetch = async () => { throw new Error('offline'); };
    await state.refreshAdminShortcut();
    assert.equal(state.adminShortcutSnapshot(), 'allowed');
    time += 1000;
    global.fetch = async () => Response.json({ allowed: false });
    await state.refreshAdminShortcut();
    assert.equal(state.adminShortcutSnapshot(), 'denied');
    time += 1000;
    global.fetch = () => new Promise(resolve => { finish = resolve; });
    const stale = state.refreshAdminShortcut();
    state.clearAdminShortcut();
    finish(Response.json({ allowed: true })); await stale;
    assert.equal(state.adminShortcutSnapshot(), 'denied', 'Old response cannot restore visibility after logout');
  } finally { global.fetch = originalFetch; Date.now = originalNow; }
});

test('unknown visitor is never promoted by provider errors or malformed data', async () => {
  const originalFetch = global.fetch;
  try {
    for (const response of [new Response(null, { status: 503 }), Response.json({ allowed: 'true' }), Response.json({}), new Response(null, { status: 401 })]) {
      global.fetch = async () => response;
      const state = createLoader()('lib/admin-shortcut.ts').createAdminShortcut(false);
      await state.refreshAdminShortcut();
      assert.notEqual(state.adminShortcutSnapshot(), 'allowed');
    }
  } finally { global.fetch = originalFetch; }
});

test('owner is visible in the initial server snapshot and independent visitors never share state', () => {
  const { createAdminShortcut } = createLoader()('lib/admin-shortcut.ts');
  const owner = createAdminShortcut(true);
  const guest = createAdminShortcut(false);
  assert.equal(owner.adminShortcutServerSnapshot(), 'allowed');
  assert.equal(owner.adminShortcutSnapshot(), 'allowed');
  assert.equal(guest.adminShortcutServerSnapshot(), 'denied');
  owner.clearAdminShortcut();
  assert.equal(guest.adminShortcutSnapshot(), 'denied');
});
