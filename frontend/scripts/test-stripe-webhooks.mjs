// Opt-in real Stripe TEST events. Uses one disposable customer and exact-ID cleanup.
import Stripe from 'stripe';
import { neon } from '@neondatabase/serverless';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

if (!process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_')) throw new Error('Test key required.');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { maxNetworkRetries: 0, timeout: 20000 });
const sql = neon(process.env.DATABASE_URL);
const fixture = `webhook-fixture-${randomUUID()}`;
const metadata = { integration: 'continental-theatre-v1', userId: fixture, fixture };
let customer, product, subscription;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitForRow(predicate) {
  const deadline = Date.now() + 55000;
  while (Date.now() < deadline) {
    const [row] = await sql`select status, paid_through, revoked_at, synced_at from theatre_subscriptions where user_id = ${fixture}`;
    if (row && predicate(row)) return row;
    await pause(1500);
  }
  throw new Error('Timed out waiting for webhook-only database synchronization.');
}
try {
  for (const provider of ['stripe', 'mux']) {
    const response = await fetch(`http://localhost:3000/api/${provider}/webhook`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    });
    assert.equal(response.status, 400, `${provider} must reject unsigned requests`);
  }
  console.log('PASS: both local webhook endpoints reject unsigned requests (400).');
  customer = await stripe.customers.create({ metadata, payment_method: 'pm_card_visa', invoice_settings: { default_payment_method: 'pm_card_visa' }, name: 'Disposable local webhook verification' }, { idempotencyKey: fixture + '-customer' });
  await sql`insert into theatre_members (user_id, customer_id, checkout_attempt) values (${fixture}, ${customer.id}, ${randomUUID()})`;
  product = await stripe.products.create({ name: 'Disposable Theatre webhook test', metadata }, { idempotencyKey: fixture + '-product' });
  subscription = await stripe.subscriptions.create({ customer: customer.id, metadata,
    items: [{ price_data: { product: product.id, currency: 'usd', unit_amount: 599, recurring: { interval: 'month' } } }],
    expand: ['latest_invoice'],
  }, { idempotencyKey: fixture + '-subscription' });
  assert.equal(subscription.livemode, false);
  assert.equal(subscription.latest_invoice.status, 'paid');
  const active = await waitForRow(row => row.status === 'active' && row.paid_through && !row.revoked_at);
  console.log('PASS: real paid test subscription synchronized to active via CLI webhook delivery only (no membership API polling).');
  await pause(3000);
  const [before] = await sql`select synced_at from theatre_subscriptions where user_id = ${fixture}`;
  await stripe.subscriptions.update(subscription.id, { cancel_at_period_end: true });
  await waitForRow(row => row.status === 'active' && new Date(row.synced_at) > new Date(before.synced_at));
  console.log('PASS: scheduled cancellation notification synchronized while retaining paid access.');
  await stripe.subscriptions.cancel(subscription.id);
  await waitForRow(row => row.status === 'canceled' && row.revoked_at);
  console.log('PASS: cancellation notification marks the disposable membership canceled/revoked.');
  assert.ok(new Date(active.paid_through) > new Date());
} catch (error) {
  console.error('Stripe webhook test incomplete: ' + (error.type || error.message));
  process.exitCode = 1;
} finally {
  try {
    if (subscription) {
      const current = await stripe.subscriptions.retrieve(subscription.id);
      if (current.status !== 'canceled') await stripe.subscriptions.cancel(subscription.id);
      await pause(5000);
    }
    if (customer) await stripe.customers.del(customer.id);
    if (product) await stripe.products.update(product.id, { active: false });
    await sql`delete from theatre_subscriptions where user_id = ${fixture}`;
    await sql`delete from theatre_members where user_id = ${fixture}`;
    console.log('Cleanup: disposable test customer deleted, product archived, fixture database rows removed. Test event history remains in Stripe.');
  } catch { console.error('Fixture cleanup needs review; real user accounts were not touched.'); process.exitCode = 1; }
}
