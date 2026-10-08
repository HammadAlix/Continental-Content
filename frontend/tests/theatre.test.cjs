/* eslint-disable @typescript-eslint/no-require-imports -- Node regression tests. */
const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('./office-loader.cjs')();
const { THEATRE_PLAN, hasTheatreEntitlement } = load('lib/theatre.ts');
const { subscriptionEntitlement } = load('server/theatre/subscription-policy.ts');

function subscription() {
  return {
    customer: 'cus_test', livemode: false, status: 'active',
    metadata: { integration: 'continental-theatre-v1', userId: 'user_test' },
    items: { data: [{ quantity: 1, current_period_end: 2000000000,
      price: { currency: 'usd', unit_amount: 599, recurring: { interval: 'month', interval_count: 1 } } }] },
    latest_invoice: { livemode: false, status: 'paid', currency: 'usd', amount_paid: 599, amount_remaining: 0 },
  };
}
test('one monthly plan costs exactly 599 USD cents', () => {
  assert.equal(THEATRE_PLAN.amount, 599);
  assert.equal(THEATRE_PLAN.interval, 'month');
});
test('paid matching test membership grants access through its paid period', () => {
  const state = subscriptionEntitlement(subscription(), 'cus_test', 'user_test');
  assert.equal(hasTheatreEntitlement(state, new Date(1900000000000)), true);
  assert.equal(hasTheatreEntitlement(state, new Date(2000000000000)), false);
});
test('wrong owner or live mode cannot become a test entitlement', () => {
  for (const change of [{ customer: 'cus_other' }, { livemode: true }, { metadata: { integration: 'continental-theatre-v1', userId: 'other' } }]) {
    assert.throws(() => subscriptionEntitlement({ ...subscription(), ...change }, 'cus_test', 'user_test'));
  }
});
test('unpaid, unexpanded and partially paid invoices never grant access', () => {
  for (const invoice of [null, 'in_test', { status: 'open' }, { ...subscription().latest_invoice, amount_paid: 100 }]) {
    const state = subscriptionEntitlement({ ...subscription(), latest_invoice: invoice }, 'cus_test', 'user_test');
    assert.equal(hasTheatreEntitlement(state), false);
  }
});
test('wrong amount, currency, interval, quantity or multiple items deny access', () => {
  for (const mutate of [s => s.items.data[0].price.unit_amount = 1, s => s.items.data[0].price.currency = 'eur',
    s => s.items.data[0].price.recurring.interval = 'year', s => s.items.data[0].quantity = 2,
    s => s.items.data.push(s.items.data[0])]) {
    const s = subscription(); mutate(s);
    assert.equal(hasTheatreEntitlement(subscriptionEntitlement(s, 'cus_test', 'user_test')), false);
  }
});
test('only active paid membership passes; cancellation and expiry fail closed', () => {
  for (const status of ['trialing', 'incomplete', 'incomplete_expired', 'past_due', 'unpaid', 'paused', 'canceled']) {
    assert.equal(hasTheatreEntitlement(subscriptionEntitlement({ ...subscription(), status }, 'cus_test', 'user_test')), false);
  }
  assert.equal(hasTheatreEntitlement(null), false);
});
