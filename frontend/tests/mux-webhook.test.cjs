/* eslint-disable @typescript-eslint/no-require-imports -- Isolated provider signature regression tests. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const Mux = require('@mux/ts').default;
const createLoader = require('./office-loader.cjs');

test('Mux webhook verifies raw signatures and timestamps before reading the database', async () => {
  const previous = process.env.MUX_WEBHOOK_SECRET;
  const secret = 'fixture-webhook-secret-not-a-real-credential';
  process.env.MUX_WEBHOOK_SECRET = secret;
  const client = new Mux({ tokenId: 'fixture', tokenSecret: 'fixture', maxRetries: 0 });
  const route = createLoader({
    '@/server/theatre/mux': { mux: () => client },
    '@/server/db/client': { db: () => { throw new Error('Signature test must not read database'); } },
  })('app/api/mux/webhook/route.ts');
  const body = JSON.stringify({ type: 'video.asset.created', data: { id: 'fixture' } });
  const now = Math.floor(Date.now() / 1000);
  const signature = time => 't=' + time + ',v1=' + createHmac('sha256', secret).update(time + '.' + body).digest('hex');
  const request = (payload, header) => new Request('http://localhost/api/mux/webhook', {
    method: 'POST', body: payload, headers: header ? { 'mux-signature': header } : {},
  });
  try {
    assert.equal((await route.POST(request(body, signature(now)))).status, 200);
    assert.equal((await route.POST(request(body, null))).status, 400);
    assert.equal((await route.POST(request(body + ' ', signature(now)))).status, 400);
    assert.equal((await route.POST(request(body, signature(now - 3600)))).status, 400);
    delete process.env.MUX_WEBHOOK_SECRET;
    assert.equal((await route.POST(request(body, signature(now)))).status, 503);
  } finally {
    if (previous === undefined) delete process.env.MUX_WEBHOOK_SECRET;
    else process.env.MUX_WEBHOOK_SECRET = previous;
  }
});

test('signed lifecycle events dispatch safe asset IDs; provider failures request retry', async () => {
  const previous = process.env.MUX_WEBHOOK_SECRET;
  const secret = 'fixture-dispatch-secret-not-a-real-credential';
  process.env.MUX_WEBHOOK_SECRET = secret;
  const client = new Mux({ tokenId: 'fixture', tokenSecret: 'fixture', maxRetries: 0 });
  const calls = [];
  let fail = false;
  const route = createLoader({
    '@/server/theatre/mux': { mux: () => client },
    '@/server/theatre/catalogue': {
      validMuxAssetId: value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,255}$/.test(value),
      syncMuxCatalogueVideo: async id => { if (fail) throw new Error('Temporary provider failure'); calls.push(['sync', id]); },
      deleteMuxCatalogueVideo: async id => { calls.push(['delete', id]); },
    },
  })('app/api/mux/webhook/route.ts');
  const send = (type, id) => {
    const body = JSON.stringify({ type, data: { id, meta: { title: 'Do not trust event metadata' } } });
    const now = Math.floor(Date.now() / 1000);
    const signature = 't=' + now + ',v1=' + createHmac('sha256', secret).update(now + '.' + body).digest('hex');
    return route.POST(new Request('http://localhost/api/mux/webhook', {
      method: 'POST', body, headers: { 'mux-signature': signature },
    }));
  };
  try {
    for (const type of ['ready', 'updated', 'errored']) assert.equal((await send('video.asset.' + type, 'fixture')).status, 200);
    assert.equal((await send('video.asset.deleted', 'fixture')).status, 200);
    assert.deepEqual(calls, [['sync', 'fixture'], ['sync', 'fixture'], ['sync', 'fixture'], ['delete', 'fixture']]);
    assert.equal((await send('video.asset.ready', '../invalid')).status, 400);
    assert.equal((await send('video.asset.ready', undefined)).status, 400);
    assert.equal(calls.length, 4);
    fail = true;
    assert.equal((await send('video.asset.updated', 'fixture')).status, 500);
    assert.equal((await send('video.asset.created', 'fixture')).status, 200);
  } finally {
    if (previous === undefined) delete process.env.MUX_WEBHOOK_SECRET;
    else process.env.MUX_WEBHOOK_SECRET = previous;
  }
});
