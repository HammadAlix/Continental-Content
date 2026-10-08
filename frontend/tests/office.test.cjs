/* eslint-disable @typescript-eslint/no-require-imports -- Node test suite. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const load = require('./office-loader.cjs')();
const { readOfficeBody, verifyOfficeRequest, officeClientIp } = load('server/service-requests/http.ts');
const { validateServiceRequest } = load('server/service-requests/validation.ts');
const { sendOfficeEmail } = load('server/lib/mailer.ts');
const origin = 'http://localhost:3000';

test('multiple services are validated, deduplicated and ordered consistently with legacy requests', () => {
  const base = { name: 'Test User', email: 'TEST@example.com', details: 'A valid test request.' };
  const choices = ['project-manager', 'creative-director', 'project-manager'];
  const result = validateServiceRequest({ ...base, services: choices });
  assert.equal(result.ok, true);
  assert.equal(result.value.service, 'creative-director,project-manager');
  assert.deepEqual(result, validateServiceRequest({ ...base, services: ['creative-director', 'project-manager'] }));
  assert.deepEqual(validateServiceRequest({ ...base, services: ['creative-director'] }),
    validateServiceRequest({ ...base, service: 'creative-director' }));
  const { SERVICES } = load('lib/services.ts');
  assert.equal(validateServiceRequest({ ...base, services: SERVICES.map(s => s.id) }).value.service, SERVICES.map(s => s.id).join(','));
  for (const services of [[], null, 'creative-director', [42], [{}], ['creative-director', 'fake'], Array(9).fill('creative-director')]) {
    assert.equal(validateServiceRequest({ ...base, services }).ok, false);
  }
  assert.equal(validateServiceRequest({ ...base }).ok, false);
  assert.equal(validateServiceRequest({ ...base, services: [], service: 'creative-director' }).ok, false);
  assert.equal(validateServiceRequest({ ...base, services: ['project-manager'], service: 'creative-director' }).ok, false);
});

test('all selected services are saved and included in both emails; reordered retries do not enqueue duplicates', async () => {
  const { PgDialect } = require('drizzle-orm/pg-core');
  const dialect = new PgDialect();
  let saved, params, writes = 0;
  const database = {
    select: () => ({ from: () => ({ where: async () => saved ? [saved] : [] }) }),
    execute: async query => {
      writes++;
      params = dialect.sqlToQuery(query).params;
      saved = { reference: params[0], payloadHash: params[2] };
    },
  };
  const localLoad = require('./office-loader.cjs')({
    '@/server/db/client': { db: () => database },
    '@/server/lib/rate-limit': { hashIp: async () => 'fixture-hash', checkRateLimit: async () => ({ allowed: true }), consumeLimit: async () => ({ allowed: true }) },
  });
  const keys = ['SERVICE_REQUEST_FROM', 'SERVICE_REQUEST_TO', 'RESEND_API_KEY'];
  const old = keys.map(key => process.env[key]);
  keys.forEach(key => { process.env[key] = 'fixture-only'; });
  try {
    const { SERVICES } = load('lib/services.ts');
    const ids = SERVICES.map(s => s.id);
    const body = { name: 'Test User', email: 'test@example.com', services: [...ids].reverse(), details: 'A valid test request.' };
    const context = { ip: 'fixture-ip', submissionKey: randomUUID() };
    const { submitServiceRequest } = localLoad('server/service-requests/service.ts');
    const result = await submitServiceRequest(body, context);
    assert.equal(result.status, 'ok');
    assert.equal(params[5], ids.join(','));
    assert.ok(params[5].length > 40);
    const messages = JSON.parse(params.at(-1));
    assert.equal(messages.length, 2);
    for (const message of messages) for (const service of SERVICES) assert.ok(message.payload.text.includes(service.label));
    assert.match(messages[0].payload.subject, /8 services/);
    assert.deepEqual(await submitServiceRequest({ ...body, services: ids }, context), result);
    assert.equal(writes, 1);
    assert.equal((await submitServiceRequest({ ...body, services: [ids[0]] }, context)).status, 'conflict');
    assert.equal(writes, 1);
  } finally {
    keys.forEach((key, i) => { if (old[i] === undefined) delete process.env[key]; else process.env[key] = old[i]; });
  }
});

test('office rejects wrong origin, content type and missing retry key', () => {
  const old = process.env.APP_URL; process.env.APP_URL = origin;
  try {
    const make = (headers) => new Request(origin, { method: 'POST', headers });
    const headers = { origin, 'content-type': 'application/json', 'idempotency-key': randomUUID() };
    assert.equal(verifyOfficeRequest(make(headers)), headers['idempotency-key']);
    assert.throws(() => verifyOfficeRequest(make({ ...headers, origin: 'https://evil.example' })), e => e.status === 403);
    assert.throws(() => verifyOfficeRequest(make({ ...headers, 'content-type': 'text/plain' })), e => e.status === 415);
    assert.throws(() => verifyOfficeRequest(make({ ...headers, 'idempotency-key': '' })), e => e.status === 400);
  } finally { if (old === undefined) delete process.env.APP_URL; else process.env.APP_URL = old; }
});

test('actual byte limit applies without Content-Length, including multibyte text', async () => {
  await assert.rejects(readOfficeBody(new Request(origin, { method: 'POST', body: 'x'.repeat(17000) })), e => e.status === 413);
  await assert.rejects(readOfficeBody(new Request(origin, { method: 'POST', body: JSON.stringify('é'.repeat(8500)) })), e => e.status === 413);
  await assert.rejects(readOfficeBody(new Request(origin, { method: 'POST', body: '{' })), e => e.status === 400);
  assert.deepEqual(await readOfficeBody(new Request(origin, { method: 'POST', body: '{"ok":true}' })), { ok: true });
});

test('untrusted client headers cannot select arbitrary rate-limit buckets locally', () => {
  const vercel = process.env.VERCEL, proxy = process.env.TRUST_PROXY;
  delete process.env.VERCEL; delete process.env.TRUST_PROXY;
  try { assert.equal(officeClientIp(new Request(origin, { headers: { 'x-forwarded-for': '1.2.3.4' } })), 'local-shared'); }
  finally { if (vercel !== undefined) process.env.VERCEL = vercel; if (proxy !== undefined) process.env.TRUST_PROXY = proxy; }
});

test('honeypot is recognized and invalid roles are rejected', () => {
  const body = { name: 'Test User', email: 'test@example.com', service: 'creative-director', details: 'A test request only.', courtesy: 'bot' };
  assert.equal(validateServiceRequest(body).honeypot, true);
  assert.equal(validateServiceRequest({ ...body, service: 'fake' }).ok, false);
});

test('mailer has a timeout, stable idempotency key, and recoverable provider failures', async () => {
  const oldFetch = global.fetch, oldKey = process.env.RESEND_API_KEY;
  process.env.RESEND_API_KEY = 'fixture-only';
  const payload = { from: 'desk@example.com', to: 'test@example.com', replyTo: 'desk@example.com', subject: 'Fixture', text: 'Fixture' };
  let calls = 0;
  global.fetch = async (_url, options) => {
    calls++; assert.equal(options.headers['Idempotency-Key'], 'stable-fixture'); assert.ok(options.signal instanceof AbortSignal);
    return new Response('', { status: calls === 1 ? 503 : 200 });
  };
  try {
    assert.deepEqual(await sendOfficeEmail(payload, 'stable-fixture'), { delivered: false, reason: 'provider-503', permanent: false });
    assert.equal((await sendOfficeEmail(payload, 'stable-fixture')).delivered, true);
    global.fetch = async () => { throw new Error('timeout'); };
    assert.equal((await sendOfficeEmail(payload, 'stable-fixture')).reason, 'network-or-timeout');
  } finally { global.fetch = oldFetch; if (oldKey === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = oldKey; }
});
