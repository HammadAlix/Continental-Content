/* eslint-disable @typescript-eslint/no-require-imports -- Isolated snapshot/fresh-access security regressions. */
const test = require('node:test');
const assert = require('node:assert/strict');
const createLoader = require('./office-loader.cjs');

function fixture() {
  const members = [{ userId: 'user_1', customerId: 'cus_1' }];
  const rows = [{ id: 'sub_1', userId: 'user_1', customerId: 'cus_1', status: 'active', livemode: false,
    revokedAt: null, paidThrough: new Date(Date.now() + 3600000), syncedAt: new Date() }];
  const subscription = { id: 'sub_1', customer: 'cus_1', livemode: false, status: 'active', cancel_at_period_end: false,
    metadata: { integration: 'continental-theatre-v1', userId: 'user_1' },
    items: { data: [{ quantity: 1, current_period_end: Math.floor(Date.now() / 1000) + 3600,
      price: { currency: 'usd', unit_amount: 599, recurring: { interval: 'month', interval_count: 1 } } }] },
    latest_invoice: { status: 'paid', livemode: false, currency: 'usd', amount_paid: 599, amount_remaining: 0 } };
  const counters = { list: 0, retrieve: 0, writes: 0 };
  let failure = false;
  let pages;
  const schema = { theatreMembers: { userId: 'userId' }, theatreSubscriptions: { id: 'id', userId: 'userId', livemode: 'livemode', syncedAt: 'syncedAt' } };
  const load = createLoader({
    '@/server/checkout/stripe': { stripe: () => ({ subscriptions: {
      list: async options => {
        counters.list++;
        assert.deepEqual(options.expand, ['data.latest_invoice']);
        if (failure) throw new Error('Stripe unavailable');
        return pages ? pages.shift() : { data: [structuredClone(subscription)], has_more: false };
      },
      retrieve: async () => { counters.retrieve++; if (failure) throw new Error('Stripe unavailable'); return structuredClone(subscription); },
    } }) },
    '@/server/db/schema': schema,
    '@/server/db/client': { db: () => ({
      select: () => ({ from: table => ({ where: async predicate => (table === schema.theatreMembers ? members : rows).filter(predicate).map(row => ({ ...row })) }) }),
      insert: () => ({ values: value => ({ onConflictDoUpdate: options => ({ returning: async () => {
        counters.writes++;
        const row = rows.find(row => row.id === value.id);
        if (!row) rows.push({ ...value });
        else if (!options.setWhere || options.setWhere(row)) Object.assign(row, options.set);
        else return [];
        return [{ id: value.id }];
      } }) }) }),
    }) },
    'drizzle-orm': { eq: (key, value) => row => row[key] === value, and: (...predicates) => row => predicates.every(p => p(row)), lte: (key, value) => row => row[key] <= value },
  });
  return { ...load('server/theatre/membership.ts'), rows, members, subscription, counters,
    fail: () => { failure = true; }, pages: values => { pages = values; } };
}
async function enabled(callback) {
  const previous = process.env.THEATRE_ENABLED;
  process.env.THEATRE_ENABLED = 'true';
  try { await callback(); } finally { if (previous === undefined) delete process.env.THEATRE_ENABLED; else process.env.THEATRE_ENABLED = previous; }
}

test('fresh user-scoped snapshot avoids Stripe; expiry and webhook revocation still deny immediately', () => enabled(async () => {
  const f = fixture();
  assert.equal((await f.getMembershipSnapshot('user_1')).active, true);
  assert.equal((await f.getMembershipSnapshot('other_user')).active, false);
  assert.equal(f.counters.list, 0);
  assert.equal(f.counters.retrieve, 0);
  f.rows[0].paidThrough = new Date(Date.now() - 1);
  assert.equal((await f.getMembershipSnapshot('user_1')).active, false);
  f.rows[0].paidThrough = new Date(Date.now() + 3600000);
  f.rows[0].revokedAt = new Date();
  assert.equal((await f.getMembershipSnapshot('user_1')).active, false);
  f.rows[0].status = 'canceled';
  assert.equal((await f.getMembershipSnapshot('user_1')).hasSubscription, false);
}));

test('stale snapshots reconcile once; future timestamps and provider failures never authorize stale access', () => enabled(async () => {
  const stale = fixture();
  stale.rows[0].syncedAt = new Date(Date.now() - 60001);
  assert.equal((await stale.getMembershipSnapshot('user_1')).active, true);
  assert.equal(stale.counters.list, 1);
  assert.equal(stale.counters.retrieve, 0);
  const future = fixture();
  future.rows[0].syncedAt = new Date(Date.now() + 60000);
  await assert.rejects(future.getMembershipSnapshot('user_1'), /changed during verification/);
  const f = fixture();
  f.rows[0].syncedAt = new Date(Date.now() - 60001);
  f.fail();
  await assert.rejects(f.getMembershipSnapshot('user_1'), /Stripe unavailable/);
}));

test('a newer revocation cannot be overwritten or ignored by an older provider response', () => enabled(async () => {
  const f = fixture();
  f.rows[0].status = 'canceled';
  f.rows[0].revokedAt = new Date();
  f.rows[0].syncedAt = new Date(Date.now() + 1000);
  await assert.rejects(f.syncTheatreSubscription('sub_1'), /changed during verification/);
  assert.equal(f.rows[0].status, 'canceled');
  assert.ok(f.rows[0].revokedAt);
}));

test('fresh playback ignores a positive UI snapshot and detects cancellation/provider failure immediately', () => enabled(async () => {
  const f = fixture();
  assert.equal((await f.getMembershipSnapshot('user_1')).active, true);
  f.subscription.status = 'canceled'; // Provider changed before webhook arrived.
  assert.equal((await f.getMembership('user_1')).active, false);
  assert.equal(f.counters.retrieve, 1);
  assert.equal((await f.getMembershipSnapshot('user_1')).active, false);
  const unavailable = fixture();
  unavailable.fail();
  assert.equal((await unavailable.getMembershipSnapshot('user_1')).active, true);
  await assert.rejects(unavailable.getMembership('user_1'), /Stripe unavailable/);
}));

test('fresh billing gets expanded invoices in one list and retains cancellation details', () => enabled(async () => {
  const f = fixture();
  f.subscription.cancel_at_period_end = true;
  const result = await f.getMembershipDetails('user_1');
  assert.equal(result.active, true);
  assert.equal(result.hasSubscription, true);
  assert.equal(result.cancelAtPeriodEnd, true);
  assert.equal(f.counters.list, 1);
  assert.equal(f.counters.retrieve, 0);
}));

test('missing webhook rows recover from Stripe; reconciliation handles pagination and rejects wrong ownership/unpaid invoices', () => enabled(async () => {
  const f = fixture();
  f.rows.length = 0;
  f.pages([{ data: [{ ...f.subscription, id: 'unrelated', metadata: {} }], has_more: true }, { data: [f.subscription], has_more: false }]);
  assert.equal((await f.getMembershipSnapshot('user_1')).active, true);
  assert.equal(f.counters.list, 2);
  assert.equal(f.rows.length, 1);
  for (const change of [s => { s.latest_invoice.status = 'open'; }, s => { s.items.data[0].price.unit_amount = 1; }]) {
    const denied = fixture(); change(denied.subscription);
    assert.equal((await denied.getMembershipDetails('user_1')).active, false);
  }
  const wrongOwner = fixture(); wrongOwner.subscription.customer = 'other_customer';
  await assert.rejects(wrongOwner.getMembershipDetails('user_1'), /ownership mismatch/);
}));

test('old canceled snapshots also reconcile so a later membership cannot stay hidden indefinitely', () => enabled(async () => {
  const f = fixture();
  f.rows[0].status = 'canceled';
  f.rows[0].revokedAt = new Date();
  f.rows[0].syncedAt = new Date(Date.now() - 60001);
  f.subscription.id = 'sub_2';
  assert.equal((await f.getMembershipSnapshot('user_1')).active, true);
  assert.equal(f.counters.list, 1);
}));
