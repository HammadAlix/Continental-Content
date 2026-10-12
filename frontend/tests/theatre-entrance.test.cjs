/* eslint-disable @typescript-eslint/no-require-imports -- Isolated server-route tests. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const createLoader = require('./office-loader.cjs');

test('Theatre entrance distinguishes signed-out, unverified, unpaid, setup and paid access', async () => {
  const original = process.env.THEATRE_ENABLED;
  try {
    for (const [enabled, access, expected] of [
      ['true', { allowed: false, reason: 'sign-in-required' }, '/membership'],
      ['true', { allowed: false, reason: 'verification-required' }, '/membership'],
      ['true', { allowed: false, reason: 'subscription-required' }, '/membership'],
      ['true', { allowed: false, reason: 'unavailable' }, '/membership?notice=unavailable'],
      ['', { allowed: false, reason: 'subscription-required' }, '/membership?notice=setup'],
      ['', { allowed: true, reason: 'paid-membership' }, '/membership?notice=setup'],
      ['true', { allowed: true, reason: 'paid-membership' }, null],
    ]) {
      process.env.THEATRE_ENABLED = enabled;
      const { theatreDestination } = createLoader({
        '@/server/auth/member': { getTheatreAccess: async () => access },
      })('server/theatre/entrance.ts');
      assert.equal(await theatreDestination(), expected);
    }
    const { theatreDestination } = createLoader({
      '@/server/auth/member': { getTheatreAccess: async () => { throw new Error('provider down'); } },
    })('server/theatre/entrance.ts');
    assert.equal(await theatreDestination(), '/membership?notice=unavailable');
  } finally {
    if (original === undefined) delete process.env.THEATRE_ENABLED;
    else process.env.THEATRE_ENABLED = original;
  }
});

test('post-login destinations use a fixed whitelist, not arbitrary URLs', () => {
  const { accountNavigation } = createLoader()('lib/account-navigation.ts');
  assert.equal(accountNavigation('theatre').destination, '/theatre');
  assert.equal(accountNavigation('theatre').signUp, '/sign-up?next=theatre');
  assert.equal(accountNavigation('membership').destination, '/membership');
  assert.equal(accountNavigation('membership').signUp, '/sign-up?next=membership');
  assert.equal(accountNavigation('membership').signIn, '/sign-in?next=membership');
  assert.equal(accountNavigation('billing').destination, '/account/theatre');
  for (const input of [undefined, '/admin/store', '//evil.example', 'https://evil.example', ['theatre'], 'THEATRE']) {
    assert.equal(accountNavigation(input).destination, '/account');
  }
});

function pageFixture(destination, brokenDb = false) {
  let queries = 0;
  const component = () => null;
  const loadedModule = { exports: {} };
  const mocks = {
    '@clerk/nextjs': { ClerkProvider: component },
    'next/link': component,
    'next/navigation': { redirect: target => { throw new Error('redirect:' + target); } },
    '@/assets/assets': { assets: { theatreRoom: {} } },
    '@/components/BackToFoyer/BackToFoyer': component,
    '@/components/Navbar/Navbar': component,
    '@/components/RoomBackdrop/RoomBackdrop': component,
    '@/components/TheatreMembership/TheatreScreenings': component,
    '@/server/theatre/entrance': { theatreEntrance: async () => ({ destination, paidThrough: destination ? null : new Date(Date.now() + 60000) }) },
    '@/server/theatre/mux': { theatreThumbnails: async () => ({}) },
    '@/server/db/client': { db: () => {
      queries++;
      if (brokenDb) throw new Error('private database error');
      return { select: () => ({ from: () => ({ where: async () => [] }) }) };
    } },
    '@/server/db/schema': { theatreVideos: { published: 'published', status: 'status' } },
  };
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/app/theatre/page.tsx'), 'utf8'), {
    fileName: 'page.tsx', compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  new Function('require', 'module', 'exports', code)(name => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (name.endsWith('.css')) return {};
    return require(name);
  }, loadedModule, loadedModule.exports);
  return { page: loadedModule.exports.default, queries: () => queries };
}

test('actual Theatre page redirects before querying its library for every denied entrance', async () => {
  for (const destination of ['/membership', '/membership?notice=setup', '/membership?notice=unavailable']) {
    const fixture = pageFixture(destination);
    await assert.rejects(fixture.page(), error => error.message === 'redirect:' + destination);
    assert.equal(fixture.queries(), 0);
  }
});

test('actual Theatre page loads library only after access; database failure closes the room', async () => {
  const allowed = pageFixture(null);
  assert.ok(await allowed.page());
  assert.equal(allowed.queries(), 1);
  const unavailable = pageFixture(null, true);
  await assert.rejects(unavailable.page(), /redirect:\/account\/theatre\?notice=unavailable/);
});
