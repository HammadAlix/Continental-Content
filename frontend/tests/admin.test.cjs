/* eslint-disable @typescript-eslint/no-require-imports -- Isolated Node tests. */
const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const createLoader = require('./office-loader.cjs');
const load = createLoader();
const { validateProduct } = load('lib/admin-product.ts');
const { validateCheckout } = load('lib/checkout.ts');
const { preparePhoto } = load('server/admin/photo.ts');
const { adminBody } = load('server/admin/http.ts');
const valid = { id: 'test-hoodie', name: 'Test', category: 'Hoodie', group: 'hoodies',
  price: 6099, sizes: ['S','M'], description: 'Plain text', published: false, revision: 0 };

test('foyer access endpoint returns only a private non-cacheable owner boolean', async () => {
  for (const admin of [null, { id: 'owner', email: 'private@example.com' }]) {
    const route = createLoader({ '@/server/auth/admin': { getAdmin: async () => admin } })('app/api/admin/access/route.ts');
    const response = await route.GET();
    assert.deepEqual(await response.json(), { allowed: Boolean(admin) });
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.equal(response.headers.get('vary'), 'Cookie');
  }
});

test('foyer shortcut fails closed if the identity provider is unavailable', async () => {
  const route = createLoader({ '@/server/auth/admin': { getAdmin: async () => { throw new Error('private provider failure'); } } })('app/api/admin/access/route.ts');
  const response = await route.GET();
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { allowed: false });
});

test('owner check denies missing configuration, anonymous, unverified and other accounts', async () => {
  const original = process.env.ADMIN_EMAIL;
  try {
    for (const [configured, member, allowed] of [
      ['', { email: 'dw@continentalcontent.com', emailVerified: true }, false],
      ['dw@continentalcontent.com', null, false],
      ['dw@continentalcontent.com', { email: 'dw@continentalcontent.com', emailVerified: false }, false],
      ['dw@continentalcontent.com', { email: 'customer@example.com', emailVerified: true, isAdmin: true }, false],
      ['dw@continentalcontent.com', { email: null, emailVerified: true }, false],
      ['dw@continentalcontent.com', { id: 'owner', email: 'DW@continentalcontent.com', emailVerified: true }, true],
    ]) {
      process.env.ADMIN_EMAIL = configured;
      const auth = createLoader({ './member': { getMember: async () => member } })('server/auth/admin.ts');
      assert.equal(Boolean(await auth.getAdmin()), allowed);
    }
  } finally { if (original === undefined) delete process.env.ADMIN_EMAIL; else process.env.ADMIN_EMAIL = original; }
});

test('product validation rejects malformed fields and only keeps permitted properties', () => {
  assert.equal(validateProduct(valid).product.price, 6099);
  assert.equal(validateProduct({ ...valid, isAdmin: true, imageUrl: 'https://attacker' }).product.imageUrl, undefined);
  for (const change of [
    { id: '../admin' }, { id: 'a--b' }, { name: '' }, { name: 'x'.repeat(101) },
    { group: ['hoodies'] }, { group: 'bad' }, { price: -1 }, { price: 50.5 },
    { price: '6000' }, { price: 1000001 }, { sizes: [] }, { sizes: ['S','S'] },
    { sizes: ['XX'] }, { published: 'true' }, { revision: -1 }, { revision: 1.2 }, { imageData: {} },
  ]) assert.throws(() => validateProduct({ ...valid, ...change }));
});

test('checkout and saved carts use the supplied database catalogue, not seed prices', () => {
  const { product } = validateProduct(valid);
  const input = { attemptId: '96d87df9-c8fb-4826-9ce3-7f71e8f65855', cart: [{ productId: product.id, size: 'S', quantity: 2, price: 1 }] };
  assert.equal(validateCheckout(input, [product]).subtotal, 12198);
  assert.throws(() => validateCheckout(input, []));
  assert.throws(() => validateCheckout(input, [{ ...product, sizes: ['M'] }]));
  global.localStorage = { getItem: () => JSON.stringify(input.cart) };
  try {
    const { readMerchCart } = load('lib/merch.ts');
    assert.equal(readMerchCart([product]).length, 1);
    assert.equal(readMerchCart([]).length, 0);
  } finally { delete global.localStorage; }
});

test('photos are decoded and re-encoded; SVG, corrupt bytes and oversized inputs rejected', async () => {
  const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#d4af37' } }).png().toBuffer();
  const output = await preparePhoto('data:image/png;base64,' + png.toString('base64'));
  assert.equal((await sharp(Buffer.from(output, 'base64')).metadata()).format, 'webp');
  assert.equal(await preparePhoto(null), null);
  assert.equal(await preparePhoto(undefined), undefined);
  for (const value of ['https://example.com/a.png', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,YmFk',
    'data:image/png;base64,' + Buffer.alloc(2 * 1024 * 1024 + 1).toString('base64')]) await assert.rejects(preparePhoto(value));
});

test('admin request rejects cross-origin and unauthorized requests before any database work', async () => {
  let authCalls = 0;
  const handler = createLoader({
    '@/server/auth/admin': { getAdmin: async () => { authCalls++; return null; } },
    '@/server/checkout/stripe': { checkoutOrigin: () => 'https://store.example' },
    '@/server/db/client': { db: () => { throw new Error('must not touch DB'); } },
  })('server/admin/http.ts');
  const foreign = await handler.adminRequest(new Request('https://store.example/api/admin/products', { method: 'POST', headers: { origin: 'https://evil.example' } }));
  assert.equal(foreign.response.status, 403); assert.equal(authCalls, 0);
  const anonymous = await handler.adminRequest(new Request('https://store.example/api/admin/products'));
  assert.equal(anonymous.response.status, 403); assert.equal(authCalls, 1);
  assert.equal(anonymous.response.headers.get('cache-control'), 'private, no-store');
});

test('admin rate limit returns 429 and Retry-After using shared storage', async () => {
  const chain = { values: () => chain, onConflictDoUpdate: () => chain, returning: async () => [{ count: 31 }] };
  const handler = createLoader({
    '@/server/auth/admin': { getAdmin: async () => ({ id: 'owner' }) },
    '@/server/db/client': { db: () => ({ insert: () => chain }) },
  })('server/admin/http.ts');
  const result = await handler.adminRequest(new Request('https://store.example/api/admin/products'));
  assert.equal(result.response.status, 429); assert.equal(result.response.headers.get('retry-after'), '60');
});

test('admin body limits content type, JSON syntax and payload bytes', async () => {
  const request = body => new Request('http://localhost/api/admin/products', { method: 'POST', headers: { 'content-type': 'application/json' }, body });
  assert.deepEqual(await adminBody(request('{"ok":true}')), { ok: true });
  await assert.rejects(adminBody(request('{')));
  await assert.rejects(adminBody(request('x'.repeat(2900001))));
  await assert.rejects(adminBody(new Request('http://localhost', { method: 'POST', body: '{}' })));
});
