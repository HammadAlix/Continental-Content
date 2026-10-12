/* eslint-disable @typescript-eslint/no-require-imports -- Isolated page rendering tests. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { THEATRE_PLAN } = require('./office-loader.cjs')()('lib/theatre.ts');

function loadComponent(file, mocks = {}) {
  const loadedModule = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), {
    fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  new Function('require', 'module', 'exports', code)(name => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (name.endsWith('.css')) return {};
    if (name === 'next/link') return ({ href, children, className }) => React.createElement('a', { href, className }, children);
    return require(name);
  }, loadedModule, loadedModule.exports);
  return loadedModule.exports.default;
}

test('public membership offer remains readable for guests and provider failures without private video data', async () => {
  const previous = process.env.THEATRE_ENABLED;
  try {
    for (const [member, viewer] of [[null, 'guest'], [{ emailVerified: false }, 'unverified'], [{ emailVerified: true }, 'verified'], ['failure', 'unavailable']]) {
      let joinProps;
      process.env.THEATRE_ENABLED = 'false';
      const page = loadComponent('app/(membership)/membership/page.tsx', {
        '@/lib/theatre': { THEATRE_PLAN },
        '@/server/theatre/membership': { getMembershipSnapshot: async () => { throw new Error('Disabled Theatre must not check subscriptions'); } },
        '@/server/auth/member': { getMember: async () => { if (member === 'failure') throw new Error('provider down'); return member; } },
        '@/components/TheatreMembership/MembershipJoin': props => { joinProps = props; return null; },
      });
      const html = renderToStaticMarkup(await page({ searchParams: Promise.resolve({}) }));
      assert.ok(html.includes('$5.99 USD / month'));
      assert.ok(html.includes(THEATRE_PLAN.includes));
      assert.doesNotMatch(html, /FairPlay|iPhone|iPad|Safari/i);
      assert.ok(!html.includes('mux-player'));
      assert.equal(joinProps.enabled, false);
      assert.equal(joinProps.viewer, viewer);
      assert.equal(joinProps.initialMembership, null);
    }
  } finally {
    if (previous === undefined) delete process.env.THEATRE_ENABLED; else process.env.THEATRE_ENABLED = previous;
  }
});

test('billing and screening copy omits Apple setup notices while retaining test-mode labels', () => {
  const Billing = loadComponent('components/TheatreMembership/TheatreMembership.tsx', {
    '@/lib/theatre': { THEATRE_PLAN },
  });
  const Screenings = loadComponent('components/TheatreMembership/TheatreScreenings.tsx', {
    '@mux/mux-player-react': () => null,
    '@/components/FoyerAudio/musicFocus': require('./office-loader.cjs')()('components/FoyerAudio/musicFocus.ts'),
  });
  const billing = renderToStaticMarkup(React.createElement(Billing, { enabled: true }));
  const screenings = renderToStaticMarkup(React.createElement(Screenings, { videos: [] }));
  assert.doesNotMatch(billing + screenings, /FairPlay|iPhone|iPad|Safari/i);
  assert.match(billing, /Test payments only/);
  assert.match(screenings, /Test membership access/);
  const checkout = fs.readFileSync(path.join(__dirname, '../src/server/theatre/checkout.ts'), 'utf8');
  assert.doesNotMatch(checkout, /Apple|FairPlay/i);
  assert.match(checkout, /No real payment/);
});

test('join UI keeps setup closed, preserves login destination and never offers checkout before membership verification', () => {
  const Join = loadComponent('components/TheatreMembership/MembershipJoin.tsx');
  const render = props => renderToStaticMarkup(React.createElement(Join, props));
  const disabled = render({ enabled: false, viewer: 'guest' });
  assert.ok(disabled.includes('Membership opens soon'));
  assert.ok(disabled.includes('disabled=""'));
  const guest = render({ enabled: true, viewer: 'guest' });
  assert.ok(guest.includes('/sign-up?next=membership'));
  assert.ok(guest.includes('/sign-in?next=membership'));
  const verified = render({ enabled: true, viewer: 'verified' });
  assert.ok(verified.includes('Checking your membership'));
  assert.ok(!verified.includes('Continue to test checkout'));
  const unverified = render({ enabled: true, viewer: 'unverified' });
  assert.ok(unverified.includes('/account/settings'));
  assert.ok(!unverified.includes('Continue to test checkout'));
  const active = render({ enabled: true, viewer: 'verified', initialMembership: { active: true, hasSubscription: true } });
  assert.match(active, /Enter Theatre/);
  assert.doesNotMatch(active, /Checking your membership/);
});

test('verified membership page seeds the button server-side; stale provider failures never expose checkout', async () => {
  const previous = process.env.THEATRE_ENABLED;
  process.env.THEATRE_ENABLED = 'true';
  try {
    for (const failed of [false, true]) {
      let props;
      const Page = loadComponent('app/(membership)/membership/page.tsx', {
        '@/lib/theatre': { THEATRE_PLAN },
        '@/server/auth/member': { getMember: async () => ({ id: 'fixture', emailVerified: true }) },
        '@/server/theatre/membership': { getMembershipSnapshot: async id => {
          assert.equal(id, 'fixture');
          if (failed) throw new Error('Provider unavailable');
          return { active: true, hasSubscription: true };
        } },
        '@/components/TheatreMembership/MembershipJoin': value => { props = value; return null; },
      });
      renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
      assert.equal(props.viewer, failed ? 'unavailable' : 'verified');
      assert.deepEqual(props.initialMembership, failed ? null : { active: true, hasSubscription: true });
    }
  } finally { if (previous === undefined) delete process.env.THEATRE_ENABLED; else process.env.THEATRE_ENABLED = previous; }
});
