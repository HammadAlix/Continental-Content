/* eslint-disable @typescript-eslint/no-require-imports -- Opt-in integration tests; real DB, mocked mail. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { eq, inArray } = require('drizzle-orm');

test('office concurrency, limits, durable recovery and replay safety', { skip: process.env.OFFICE_DB_TEST !== '1' }, async () => {
  let deliveries = 0, fail = true;
  const load = require('./office-loader.cjs')({
    '@/server/lib/mailer': { sendOfficeEmail: async () => { deliveries++; return fail ? { delivered: false, reason: 'simulated-outage' } : { delivered: true }; } },
  });
  const { db } = load('server/db/client.ts');
  const { serviceRequests, officeEmailJobs, checkoutLimits } = load('server/db/schema.ts');
  const { submitServiceRequest } = load('server/service-requests/service.ts');
  const { consumeLimit, hashIp } = load('server/lib/rate-limit.ts');
  const { runOfficeOutbox } = load('server/service-requests/outbox.ts');
  const id = randomUUID(), counter = 'fixture:' + id, ip = 'fixture-ip:' + id;
  const reference = 'CC-' + createHash('sha256').update(id).digest('hex').slice(0,13).toUpperCase();
  const email = id + '@example.invalid';
  const body = { name: 'Automated Test', email, service: 'creative-director', details: 'Automated database test; email delivery is mocked.' };
  const cleanupKeys = [];
  const remember = async (key, seconds) => { cleanupKeys.push(await hashIp('office:' + key + ':' + seconds + ':' + Math.floor(Date.now() / (seconds * 1000)))); };
  await remember(counter, 3600);
  await remember('submit:' + await hashIp(ip), 3600);
  await remember('submit:' + await hashIp(ip), 86400);
  await remember('recipient:' + await hashIp(email), 86400);
  try {
    const limits = await Promise.all(Array.from({ length: 8 }, () => consumeLimit(counter, 3600, 3)));
    assert.equal(limits.filter(r => r.allowed).length, 3);
    assert.ok(limits.filter(r => !r.allowed).every(r => r.retryAfter > 0));
    const context = { ip, submissionKey: id };
    const results = await Promise.all([submitServiceRequest(body, context), submitServiceRequest(body, context)]);
    assert.ok(results.every(r => r.status === 'ok'));
    assert.equal(results[0].reference, results[1].reference);
    assert.equal((await db().select().from(serviceRequests).where(eq(serviceRequests.reference, reference))).length, 1);
    assert.equal((await db().select().from(officeEmailJobs).where(eq(officeEmailJobs.reference, reference))).length, 2);
    assert.equal((await submitServiceRequest({ ...body, details: 'Changed payload should not be accepted.' }, context)).status, 'conflict');
    await runOfficeOutbox(reference);
    let jobs = await db().select().from(officeEmailJobs).where(eq(officeEmailJobs.reference, reference));
    assert.ok(jobs.every(j => j.status === 'pending' && j.attempts === 1 && j.lastError === 'simulated-outage'));
    fail = false;
    await db().update(officeEmailJobs).set({ nextAttemptAt: new Date(0) }).where(eq(officeEmailJobs.reference, reference));
    await Promise.all([runOfficeOutbox(reference), runOfficeOutbox(reference)]);
    jobs = await db().select().from(officeEmailJobs).where(eq(officeEmailJobs.reference, reference));
    assert.ok(jobs.every(j => j.status === 'sent' && j.sentAt && j.attempts === 2));
    assert.equal(deliveries, 4);
    await runOfficeOutbox(reference);
    assert.equal(deliveries, 4);
    assert.equal((await submitServiceRequest(body, context)).reference, reference);
  } finally {
    // Exact fixture IDs only, never existing business records.
    await db().delete(officeEmailJobs).where(eq(officeEmailJobs.reference, reference));
    await db().delete(serviceRequests).where(eq(serviceRequests.reference, reference));
    await db().delete(checkoutLimits).where(inArray(checkoutLimits.key, cleanupKeys));
  }
});
