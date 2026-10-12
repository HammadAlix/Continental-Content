/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS test loader compiles the real TS validator. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const Stripe = require('stripe');

// Transpile the real pure TypeScript validator without changing application runtime.
require.extensions['.ts'] = (module, filename) => {
  const source = fs.readFileSync(filename, 'utf8');
  module._compile(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
};
const { validateCheckout } = require('../src/lib/checkout.ts');
const { MERCH_PRODUCTS, readMerchCart } = require('../src/lib/merch.ts');
const attemptId = '96d87df9-c8fb-4826-9ce3-7f71e8f65855';
const line = { productId: 'moonlight-hoodie', size: 'M', quantity: 2 };
const input = (cart = [line]) => ({ attemptId, cart });

test('prices and total come from catalogue, not client input', () => {
  const result = validateCheckout({ ...input([{ ...line, price: 1, unitAmount: 1 }]), total: 1, shipping: 0 });
  assert.equal(result.subtotal, 12000);
  assert.equal(result.shipping, 1000);
  assert.equal(result.total, 13000);
});
test('invalid carts, products, sizes, quantities and attempt IDs are rejected', () => {
  for (const cart of [[], null, [null], [{ ...line, productId: 'fake' }], [{ ...line, size: 'FAKE' }], [{ ...line, quantity: -1 }], [{ ...line, quantity: 0 }], [{ ...line, quantity: 11 }], [{ ...line, quantity: 1.5 }], [{ ...line, quantity: '2' }], Array(26).fill(line)]) assert.throws(() => validateCheckout(input(cart)));
  assert.throws(() => validateCheckout({ ...input(), attemptId: 'guessable' }));
});
test('duplicate variants and excessive combined quantities are rejected', () => {
  assert.throws(() => validateCheckout(input([line, line])));
  assert.throws(() => validateCheckout(input(['S','M','L','XL'].map(size => ({ ...line, size, quantity: 10 })))));
});
test('canonical order is stable for retries', () => {
  const other = { productId: 'midnight-hoodie', size: 'S', quantity: 1 };
  assert.deepEqual(validateCheckout(input([line, other])), validateCheckout(input([other, line])));
});

test('all nine client products have the supplied prices and valid variants', () => {
  assert.deepEqual(MERCH_PRODUCTS.map(p => p.price), [6000,6000,7500,7500,3500,3500,6500,22500,20000]);
  for (const product of MERCH_PRODUCTS) for (const size of product.sizes) {
    const order = validateCheckout(input([{ productId: product.id, size, quantity: 1 }]));
    assert.equal(order.subtotal, product.price);
  }
  for (const productId of ['continental-apocalypse','continental-rebirth']) assert.throws(() => validateCheckout(input([{ productId, size: 'M', quantity: 1 }])));
  assert.throws(() => validateCheckout(input([{ productId: 'continental-slides', size: 'XL', quantity: 1 }])));
  assert.throws(() => validateCheckout(input([{ productId: 'moonlight-hoodie', size: '6', quantity: 1 }])));
});

test('saved bags discard retired products and invalid product-specific sizes', () => {
  global.localStorage = { getItem: () => JSON.stringify([
    { productId: 'signature', size: 'M', quantity: 1 },
    { productId: 'continental-apocalypse', size: 'M', quantity: 1 },
    { productId: 'continental-slides', size: '8', quantity: 1 },
  ]) };
  try { assert.deepEqual(readMerchCart(), [{ productId: 'continental-slides', size: '8', quantity: 1 }]); }
  finally { delete global.localStorage; }
});
test('Stripe verifies signed raw payload and rejects tampering or stale signatures', () => {
  const stripe = new Stripe('sk_test_fixture_only');
  const secret = 'whsec_fixture_only';
  const payload = JSON.stringify({ id: 'evt_test', type: 'checkout.session.completed', livemode: false, data: { object: {} } });
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret });
  assert.equal(stripe.webhooks.constructEvent(payload, header, secret).id, 'evt_test');
  assert.throws(() => stripe.webhooks.constructEvent(payload + ' ', header, secret));
  assert.throws(() => stripe.webhooks.constructEvent(payload, header, 'whsec_wrong'));
  const expired = stripe.webhooks.generateTestHeaderString({ payload, secret, timestamp: Math.floor(Date.now() / 1000) - 600 });
  assert.throws(() => stripe.webhooks.constructEvent(payload, expired, secret));
});
