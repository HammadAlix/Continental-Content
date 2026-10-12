/* eslint-disable @typescript-eslint/no-require-imports -- Real handlers/signatures, isolated provider and database doubles. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const Stripe = require('stripe');
const Mux = require('@mux/ts').default;
const createLoader = require('./office-loader.cjs');

const secret = 'webhook-failure-fixture-not-a-real-secret';
const theatreIntegration = 'continental-theatre-v1';
const merchIntegration = 'continental-merch-v1';
const columns = names => Object.fromEntries(names.map(key => [key, key]));
const schema = {
  theatreMembers: columns(['userId']),
  theatreSubscriptions: columns(['id', 'userId', 'livemode', 'syncedAt']),
  merchOrders: columns(['id']),
  theatreVideos: columns(['id', 'muxAssetId', 'title', 'status', 'playbackId', 'published']),
};
const subscriptionEvent = (type, subscription = 'sub_1') => ({ type, data: { object: { id: subscription } } });
const invoiceEvent = (type, subscription = 'sub_1') => ({ type,
  data: { object: { id: 'in_1', parent: { subscription_details: { subscription } } } } });
const checkoutEvent = (integration = theatreIntegration, subscription = 'sub_1', type = 'checkout.session.completed') => ({ type,
  data: { object: { id: 'cs_1', subscription, metadata: { integration, orderId: 'order_1' } } } });

async function fixture(run) {
  const env = { STRIPE_WEBHOOK_SECRET: secret, THEATRE_ENABLED: 'true', MUX_WEBHOOK_SECRET: secret,
    MUX_AUTO_IMPORT_ENABLED: 'true', RESEND_API_KEY: 'fixture', SERVICE_REQUEST_FROM: 'fixture@example.invalid',
    SERVICE_REQUEST_TO: 'desk@example.invalid' };
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  const previousFetch = global.fetch;
  Object.assign(process.env, env);
  const f = {
    members: [{ userId: 'user_1', customerId: 'cus_1' }], subscriptions: [], videos: [],
    orders: [{ id: 'order_1', stripeSessionId: 'cs_1', status: 'pending', subtotal: 6000, shipping: 1000, total: 7000,
      items: [{ productId: 'moonlight-hoodie', name: 'Moonlight Hoodie', unitAmount: 6000, size: 'M', quantity: 1 }] }],
    subscription: { id: 'sub_1', customer: 'cus_1', livemode: false, status: 'active',
      metadata: { integration: theatreIntegration, userId: 'user_1' },
      items: { data: [{ quantity: 1, current_period_end: Math.floor(Date.now() / 1000) + 3600,
        price: { currency: 'usd', unit_amount: 599, recurring: { interval: 'month', interval_count: 1 } } }] },
      latest_invoice: { status: 'paid', livemode: false, currency: 'usd', amount_paid: 599, amount_remaining: 0 } },
    session: { id: 'cs_1', livemode: false, mode: 'payment', status: 'complete', payment_status: 'paid',
      metadata: { integration: merchIntegration, orderId: 'order_1' }, client_reference_id: 'order_1', currency: 'usd',
      amount_total: 7000, amount_subtotal: 6000, total_details: { amount_shipping: 1000, amount_discount: 0, amount_tax: 0 },
      customer_details: { email: 'customer@example.invalid' },
      collected_information: { shipping_details: { name: 'Fixture', address: { line1: 'Test', city: 'Test', country: 'US' } } } },
    asset: { id: 'asset_1', status: 'ready', playback_ids: [{ id: 'drm_1', policy: 'drm' }], meta: { title: 'Provider title' } },
    databaseFailure: false, stripeFailure: false, muxFailure: null, emailFailure: null,
    calls: { database: 0, subscription: 0, session: 0, asset: 0 }, emails: [],
  };
  const tables = new Map([[schema.theatreMembers, f.members], [schema.theatreSubscriptions, f.subscriptions],
    [schema.merchOrders, f.orders], [schema.theatreVideos, f.videos]]);
  const checkDb = () => { f.calls.database++; if (f.databaseFailure) throw new Error('Simulated database outage'); };
  const apply = (row, value) => Object.assign(row, Object.fromEntries(Object.entries(value).map(([key, v]) => [key, typeof v === 'function' ? v(row) : v])));
  const database = {
    select: () => ({ from: table => ({ where: async predicate => {
      checkDb(); return tables.get(table).filter(predicate).map(row => structuredClone(row));
    } }) }),
    update: table => ({ set: value => ({ where: async predicate => {
      checkDb(); for (const row of tables.get(table)) if (predicate(row)) apply(row, value);
    } }) }),
    insert: table => ({ values: value => ({ onConflictDoUpdate: options => {
      const pending = Promise.resolve().then(() => {
        checkDb();
        const rows = tables.get(table), key = options.target;
        const existing = rows.find(row => row[key] === value[key]);
        if (!existing) rows.push(structuredClone(value));
        else if (!options.setWhere || options.setWhere(existing)) apply(existing, options.set);
        else return [];
        return [{ id: value.id }];
      });
      pending.returning = () => pending;
      return pending;
    } }) }),
  };
  global.fetch = async (url, options) => {
    // Fail immediately if any unmocked path attempts a real network call.
    assert.equal(url, 'https://api.resend.com/emails', 'Unexpected network access in isolated test');
    const key = options.headers['Idempotency-Key'];
    const failed = f.emailFailure && key.endsWith('-' + f.emailFailure);
    f.emails.push({ key, ok: !failed });
    return new Response('{}', { status: failed ? 503 : 200 });
  };
  const stripe = new Stripe('sk_test_fixture_only', { maxNetworkRetries: 0 });
  const muxClient = new Mux({ tokenId: 'fixture', tokenSecret: 'fixture', maxRetries: 0 });
  muxClient.video.assets.retrieve = async id => {
    f.calls.asset++; assert.equal(id, 'asset_1');
    if (f.muxFailure) throw f.muxFailure;
    return structuredClone(f.asset);
  };
  const stripeMock = {
    webhooks: stripe.webhooks,
    subscriptions: { retrieve: async (id, options) => {
      f.calls.subscription++; assert.equal(id, 'sub_1'); assert.deepEqual(options.expand, ['latest_invoice']);
      if (f.stripeFailure) throw new Error('Simulated Stripe outage');
      return structuredClone(f.subscription);
    } },
    checkout: { sessions: { retrieve: async id => {
      f.calls.session++; assert.equal(id, 'cs_1');
      if (f.stripeFailure) throw new Error('Simulated Stripe outage');
      return structuredClone(f.session);
    } } },
  };
  const mocks = {
    '@/server/db/client': { db: () => database }, '@/server/db/schema': schema,
    '@/server/checkout/stripe': { stripe: () => stripeMock },
    './stripe': { stripe: () => stripeMock },
    'drizzle-orm': {
      eq: (key, value) => row => row[key] === value, ne: (key, value) => row => row[key] !== value,
      lte: (key, value) => row => row[key] <= value,
      and: (...predicates) => row => predicates.every(p => p(row)),
      sql: (_strings, ...values) => row => row[values[0]] === values[1] ? true : row[values[2]],
    },
  };
  // Use the real DRM policy validator, not a stub that accepts any asset.
  const { protectedPlaybackId } = createLoader(mocks)('server/theatre/mux.ts');
  const muxMock = { mux: () => muxClient, protectedPlaybackId };
  const load = createLoader({ ...mocks, '@/server/theatre/mux': muxMock, './mux': muxMock });
  const stripeRoute = load('app/api/stripe/webhook/route.ts');
  const muxRoute = load('app/api/mux/webhook/route.ts');
  f.entitled = row => load('lib/theatre.ts').hasTheatreEntitlement(row);
  f.stripe = (event, options = {}) => {
    const payload = options.raw ?? JSON.stringify({ id: 'evt_fixture', livemode: false, ...event });
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret: options.secret ?? secret,
      timestamp: options.timestamp ?? Math.floor(Date.now() / 1000) });
    return stripeRoute.POST(new Request('http://localhost/api/stripe/webhook', {
      method: 'POST', body: payload + (options.tamper ? ' ' : ''), headers: options.unsigned ? {} : { 'stripe-signature': header },
    }));
  };
  f.mux = (type, options = {}) => {
    const payload = options.raw ?? JSON.stringify({ id: 'evt_fixture', type: 'video.asset.' + type,
      data: { id: options.id ?? 'asset_1', status: 'ready', meta: { title: 'Untrusted event title' } } });
    const time = options.timestamp ?? Math.floor(Date.now() / 1000);
    const header = 't=' + time + ',v1=' + createHmac('sha256', options.secret ?? secret).update(time + '.' + payload).digest('hex');
    return muxRoute.POST(new Request('http://localhost/api/mux/webhook', {
      method: 'POST', body: payload + (options.tamper ? ' ' : ''), headers: options.unsigned ? {} : { 'mux-signature': header },
    }));
  };
  try { await run(f); }
  finally {
    global.fetch = previousFetch;
    for (const key of Object.keys(env)) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
  }
}

test('Stripe handler rejects bad signatures, malformed/oversized bodies, live events and missing configuration before side effects', () => fixture(async f => {
  for (const options of [{ unsigned: true }, { secret: 'wrong' }, { tamper: true },
    { timestamp: Math.floor(Date.now() / 1000) - 3600 }, { raw: '{broken' }, { raw: 'x'.repeat(256001) }]) {
    assert.equal((await f.stripe(checkoutEvent(), options)).status, 400);
  }
  assert.equal((await f.stripe({ ...checkoutEvent(), livemode: true })).status, 400);
  delete process.env.STRIPE_WEBHOOK_SECRET;
  assert.equal((await f.stripe(checkoutEvent())).status, 503);
  assert.deepEqual(f.calls, { database: 0, subscription: 0, session: 0, asset: 0 });
  assert.equal(f.emails.length, 0);
}));

test('signed failed-payment events revoke entitlement; retries and later recovery reconcile provider truth', () => fixture(async f => {
  assert.equal((await f.stripe(invoiceEvent('invoice.paid'))).status, 200);
  assert.ok(f.entitled(f.subscriptions[0]));
  f.subscription.status = 'past_due';
  f.subscription.latest_invoice = { status: 'open', livemode: false, currency: 'usd', amount_paid: 0, amount_remaining: 599 };
  const failed = invoiceEvent('invoice.payment_failed', { id: 'sub_1' });
  for (let i = 0; i < 2; i++) assert.equal((await f.stripe(failed)).status, 200);
  assert.equal(f.subscriptions.length, 1);
  assert.equal(f.subscriptions[0].paidThrough, null);
  assert.equal(f.entitled(f.subscriptions[0]), false);
  // An old paid notification must NOT restore access when Stripe still reports unpaid.
  assert.equal((await f.stripe(invoiceEvent('invoice.paid'))).status, 200);
  assert.equal(f.entitled(f.subscriptions[0]), false);
  f.subscription.status = 'active';
  Object.assign(f.subscription.latest_invoice, { status: 'paid', amount_paid: 599, amount_remaining: 0 });
  assert.equal((await f.stripe(invoiceEvent('invoice.paid'))).status, 200);
  assert.ok(f.entitled(f.subscriptions[0]));
  // Conversely, a delayed failure notification must use the recovered provider state.
  assert.equal((await f.stripe(failed)).status, 200);
  assert.ok(f.entitled(f.subscriptions[0]));
}));

test('Theatre checkout completion and subscription lifecycle reconcile safely on duplicates and out-of-order events', () => fixture(async f => {
  for (const sub of ['sub_1', { id: 'sub_1' }]) assert.equal((await f.stripe(checkoutEvent(theatreIntegration, sub))).status, 200);
  assert.equal(f.subscriptions.length, 1);
  assert.ok(f.entitled(f.subscriptions[0]));
  f.subscription.status = 'canceled';
  assert.equal((await f.stripe(subscriptionEvent('customer.subscription.deleted'))).status, 200);
  assert.ok(f.subscriptions[0].revokedAt);
  for (const type of ['customer.subscription.created', 'customer.subscription.updated']) {
    assert.equal((await f.stripe(subscriptionEvent(type))).status, 200);
    assert.equal(f.entitled(f.subscriptions[0]), false);
  }
  assert.equal(f.calls.session, 0, 'Theatre checkout never fulfills a merch order');
}));

test('Stripe/provider, database and missing-member failures return 500 and the same event can succeed on retry', () => fixture(async f => {
  const event = checkoutEvent();
  f.stripeFailure = true;
  assert.equal((await f.stripe(event)).status, 500);
  f.stripeFailure = false; f.databaseFailure = true;
  assert.equal((await f.stripe(event)).status, 500);
  f.databaseFailure = false;
  const member = f.members.pop();
  assert.equal((await f.stripe(event)).status, 500);
  assert.equal(f.subscriptions.length, 0);
  f.members.push(member);
  assert.equal((await f.stripe(event)).status, 200);
  assert.ok(f.entitled(f.subscriptions[0]));
  assert.equal(f.subscriptions.length, 1);
}));

test('unrelated events and disabled Theatre do not grant membership or fulfill unrelated orders', () => fixture(async f => {
  for (const event of [{ type: 'payment_intent.created', data: { object: {} } },
    checkoutEvent('other-business'), invoiceEvent('invoice.paid', null)]) {
    assert.equal((await f.stripe(event)).status, 200);
  }
  process.env.THEATRE_ENABLED = 'false';
  assert.equal((await f.stripe(checkoutEvent())).status, 200);
  assert.equal(f.calls.subscription, 0);
  assert.equal(f.calls.session, 0);
  assert.equal(f.subscriptions.length, 0);
  // Turning off Theatre must not turn off merch webhook processing.
  assert.equal((await f.stripe(checkoutEvent(merchIntegration))).status, 200);
  assert.equal(f.orders[0].status, 'paid');
}));

test('merch completion/async success duplicates preserve one paid order and one accepted email per recipient', () => fixture(async f => {
  const event = checkoutEvent(merchIntegration);
  assert.equal((await f.stripe(event)).status, 200);
  const paidAt = f.orders[0].paidAt.getTime();
  assert.equal((await f.stripe(event)).status, 200);
  assert.equal((await f.stripe(checkoutEvent(merchIntegration, null, 'checkout.session.async_payment_succeeded'))).status, 200);
  assert.equal(f.orders.length, 1);
  assert.equal(f.orders[0].paidAt.getTime(), paidAt);
  assert.deepEqual(f.emails, [{ key: 'merch-order_1-customer', ok: true }, { key: 'merch-order_1-desk', ok: true }]);
}));

test('expired/unpaid merch checkout cannot become paid from event text, and old expiry cannot downgrade a paid order', () => fixture(async f => {
  f.session.status = 'expired'; f.session.payment_status = 'unpaid';
  assert.equal((await f.stripe(checkoutEvent(merchIntegration, null, 'checkout.session.expired'))).status, 200);
  assert.equal(f.orders[0].status, 'expired');
  assert.equal((await f.stripe(checkoutEvent(merchIntegration))).status, 200);
  assert.equal(f.orders[0].status, 'expired');
  assert.equal(f.emails.length, 0);
  f.session.status = 'complete'; f.session.payment_status = 'paid';
  assert.equal((await f.stripe(checkoutEvent(merchIntegration))).status, 200);
  assert.equal((await f.stripe(checkoutEvent(merchIntegration, null, 'checkout.session.expired'))).status, 200);
  assert.equal(f.orders[0].status, 'paid');
  assert.equal(f.emails.length, 2);
}));

test('merch partial notification failure retries only unsent recipient using the same idempotency key', () => fixture(async f => {
  f.emailFailure = 'desk';
  assert.equal((await f.stripe(checkoutEvent(merchIntegration))).status, 500);
  assert.equal(f.orders[0].status, 'paid');
  assert.ok(f.orders[0].customerNotifiedAt);
  assert.equal(f.orders[0].deskNotifiedAt, undefined);
  f.emailFailure = null;
  assert.equal((await f.stripe(checkoutEvent(merchIntegration))).status, 200);
  assert.ok(f.orders[0].deskNotifiedAt);
  assert.deepEqual(f.emails, [{ key: 'merch-order_1-customer', ok: true },
    { key: 'merch-order_1-desk', ok: false }, { key: 'merch-order_1-desk', ok: true }]);
}));

test('merch provider/database failures and mismatched totals fail closed; valid retry recovers', () => fixture(async f => {
  const event = checkoutEvent(merchIntegration);
  f.stripeFailure = true;
  assert.equal((await f.stripe(event)).status, 500);
  f.stripeFailure = false; f.databaseFailure = true;
  assert.equal((await f.stripe(event)).status, 500);
  f.databaseFailure = false; f.session.amount_total = 1;
  assert.equal((await f.stripe(event)).status, 500);
  assert.equal(f.orders[0].status, 'pending');
  assert.equal(f.emails.length, 0);
  f.session.amount_total = 7000;
  assert.equal((await f.stripe(event)).status, 200);
  assert.equal(f.orders[0].status, 'paid');
}));

test('Mux rejects invalid signatures, malformed/oversized input and invalid asset IDs before writes', () => fixture(async f => {
  for (const options of [{ unsigned: true }, { secret: 'wrong' }, { tamper: true },
    { timestamp: Math.floor(Date.now() / 1000) - 3600 }, { raw: '{bad' }, { raw: 'x'.repeat(256001) }, { id: '../bad' }]) {
    assert.equal((await f.mux('ready', options)).status, 400);
  }
  delete process.env.MUX_WEBHOOK_SECRET;
  assert.equal((await f.mux('ready')).status, 503);
  assert.equal(f.calls.asset, 0); assert.equal(f.calls.database, 0);
}));

test('Mux processing-error event hides existing video; delayed ready uses provider truth, safe recovery works', () => fixture(async f => {
  assert.equal((await f.mux('ready')).status, 200);
  assert.equal(f.videos[0].title, 'Provider title');
  f.asset.status = 'errored';
  assert.equal((await f.mux('errored')).status, 200);
  assert.equal(f.videos[0].status, 'unavailable');
  assert.equal(f.videos[0].playbackId, null);
  assert.equal((await f.mux('ready')).status, 200);
  assert.equal(f.videos[0].status, 'unavailable');
  f.asset.status = 'ready';
  assert.equal((await f.mux('updated')).status, 200);
  assert.equal(f.videos[0].status, 'ready');
  assert.equal(f.videos.length, 1);
}));

test('Mux provider/database outages return retryable failure; replay syncs once and deletion retries preserve tombstones', () => fixture(async f => {
  f.muxFailure = Object.assign(new Error('Mux outage'), { status: 503 });
  assert.equal((await f.mux('ready')).status, 500);
  assert.equal(f.videos.length, 0);
  f.muxFailure = null; f.databaseFailure = true;
  assert.equal((await f.mux('ready')).status, 500);
  f.databaseFailure = false;
  assert.equal((await f.mux('ready')).status, 200);
  assert.equal((await f.mux('ready')).status, 200);
  assert.equal(f.videos.length, 1);
  f.databaseFailure = true;
  assert.equal((await f.mux('deleted')).status, 500);
  f.databaseFailure = false;
  assert.equal((await f.mux('deleted')).status, 200);
  assert.equal((await f.mux('deleted')).status, 200);
  assert.equal((await f.mux('ready')).status, 200);
  assert.equal(f.videos[0].status, 'deleted');
  assert.equal(f.videos[0].published, false);
  assert.equal(f.videos[0].playbackId, null);
  assert.equal(f.videos.length, 1);
}));

test('Mux deletion-before-ready, provider 404, and asset mismatch fail safely through signed handler', () => fixture(async f => {
  assert.equal((await f.mux('deleted')).status, 200);
  assert.equal((await f.mux('ready')).status, 200);
  assert.equal(f.videos[0].status, 'deleted');
  f.videos.length = 0;
  f.muxFailure = Object.assign(new Error('Not found'), { status: 404 });
  assert.equal((await f.mux('updated')).status, 200);
  assert.equal(f.videos[0].status, 'deleted');
  f.videos.length = 0; f.muxFailure = null; f.asset.id = 'different_asset';
  assert.equal((await f.mux('ready')).status, 500);
  assert.equal(f.videos.length, 0);
}));
