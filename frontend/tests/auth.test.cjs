/* eslint-disable @typescript-eslint/no-require-imports -- Node test runner. */
const test = require('node:test');
const assert = require('node:assert/strict');
const createLoader = require('./office-loader.cjs');

function fixture({ configured = true, userId = 'user_test', user = undefined } = {}) {
  let calls = 0;
  const load = createLoader({
    '@/server/theatre/membership': { getMembershipSnapshot: async () => ({ active: false }) },
    './config': { isAuthConfigured: () => configured },
    '@clerk/nextjs/server': {
      auth: async () => { calls++; return { userId }; },
      currentUser: async () => user ?? {
        id: 'user_test', firstName: 'Test', primaryEmailAddressId: 'email_primary',
        emailAddresses: [{ id: 'email_primary', emailAddress: 'member@example.com', verification: { status: 'verified' } }],
        unsafeMetadata: { isSubscribed: true }, publicMetadata: { isSubscribed: true },
      },
    },
  });
  return { ...load('server/auth/member.ts'), calls: () => calls };
}

test('missing configuration does not invoke Clerk or grant access', async () => {
  const auth = fixture({ configured: false });
  assert.equal(await auth.getMember(), null);
  assert.deepEqual(await auth.getTheatreAccess(), { allowed: false, reason: 'unavailable' });
  assert.equal(auth.calls(), 0);
});

test('signed-out requests cannot read an account or unlock the Theatre', async () => {
  const auth = fixture({ userId: null });
  assert.equal(await auth.getMember(), null);
  assert.deepEqual(await auth.getTheatreAccess(), { allowed: false, reason: 'sign-in-required' });
});

test('a verified account is not a paid subscription, even with editable metadata', async () => {
  const auth = fixture();
  assert.deepEqual(await auth.getMember(), { id: 'user_test', name: 'Test', email: 'member@example.com', emailVerified: true });
  assert.deepEqual(await auth.getTheatreAccess(), { allowed: false, reason: 'subscription-required' });
});

test('verification of a secondary email does not verify the primary email', async () => {
  const auth = fixture({ user: {
    id: 'user_test', primaryEmailAddressId: 'primary', emailAddresses: [
      { id: 'secondary', emailAddress: 'old@example.com', verification: { status: 'verified' } },
      { id: 'primary', emailAddress: 'new@example.com', verification: { status: 'unverified' } },
    ],
  } });
  assert.deepEqual(await auth.getTheatreAccess(), { allowed: false, reason: 'verification-required' });
});

test('missing email fails closed', async () => {
  const auth = fixture({ user: { id: 'user_test', primaryEmailAddressId: null, emailAddresses: [] } });
  assert.equal((await auth.getMember()).emailVerified, false);
  assert.deepEqual(await auth.getTheatreAccess(), { allowed: false, reason: 'verification-required' });
});

test('provider identity must match the authenticated session', async () => {
  assert.equal(await fixture({ userId: 'someone_else' }).getMember(), null);
});

test('null provider verification is treated as unverified', async () => {
  const auth = fixture({ user: { id: 'user_test', primaryEmailAddressId: 'primary', emailAddresses: [
    { id: 'primary', emailAddress: 'member@example.com', verification: null },
  ] } });
  assert.deepEqual(await auth.getTheatreAccess(), { allowed: false, reason: 'verification-required' });
});

test('provider failures propagate rather than issuing a fake session', async () => {
  const load = createLoader({ './config': { isAuthConfigured: () => true }, '@clerk/nextjs/server': {
    auth: async () => { throw new Error('provider unavailable'); }, currentUser: async () => null,
  } });
  await assert.rejects(load('server/auth/member.ts').getTheatreAccess(), /provider unavailable/);
});
