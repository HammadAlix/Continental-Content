/* eslint-disable @typescript-eslint/no-require-imports -- Isolated thumbnail authorization tests. */
const test = require('node:test');
const assert = require('node:assert/strict');
const createLoader = require('./office-loader.cjs');

test('thumbnail endpoint denies anonymous/unpaid users before catalogue queries or signing', async () => {
  for (const anonymous of [true, false]) {
    const route = createLoader({
      '@/server/theatre/http': {
        theatreRequest: async () => anonymous ? { response: Response.json({}, { status: 401 }) } : { member: { id: 'fixture' } },
        theatreJson: (body, status = 200) => Response.json(body, { status }),
      },
      '@/server/theatre/membership': { getMembershipSnapshot: async () => ({ active: false }) },
      '@/server/db/client': { db: () => { throw new Error('Must not query catalogue'); } },
      '@/server/theatre/mux': { theatreThumbnails: () => { throw new Error('Must not sign'); } },
    })('app/api/theatre/thumbnails/route.ts');
    assert.equal((await route.GET(new Request('http://localhost/api/theatre/thumbnails'))).status, anonymous ? 401 : 403);
  }
});

test('thumbnail endpoint includes only published, ready entries with a playback ID', async () => {
  const rows = [
    { id: 'safe', published: true, status: 'ready', playbackId: 'drm' },
    { id: 'hidden', published: false, status: 'ready', playbackId: 'drm2' },
    { id: 'deleted', published: true, status: 'deleted', playbackId: 'drm3' },
    { id: 'missing', published: true, status: 'ready', playbackId: null },
  ];
  let signed;
  const route = createLoader({
    '@/server/theatre/http': { theatreRequest: async () => ({ member: { id: 'fixture' } }), theatreJson: (body, status = 200) => Response.json(body, { status }) },
    '@/server/theatre/membership': { getMembershipSnapshot: async () => ({ active: true, paidThrough: new Date(Date.now() + 60000) }) },
    '@/server/theatre/mux': { theatreThumbnails: async videos => { signed = videos; return { safe: 'signed-thumbnail' }; } },
    '@/server/db/schema': { theatreVideos: { id: 'id', playbackId: 'playbackId', published: 'published', status: 'status' } },
    '@/server/db/client': { db: () => ({ select: () => ({ from: () => ({ where: async predicate => rows.filter(predicate) }) }) }) },
    'drizzle-orm': { eq: (key, value) => row => row[key] === value, isNotNull: key => row => row[key] !== null, and: (...predicates) => row => predicates.every(p => p(row)) },
  })('app/api/theatre/thumbnails/route.ts');
  const response = await route.GET(new Request('http://localhost/api/theatre/thumbnails'));
  assert.equal(response.status, 200);
  assert.deepEqual(signed.map(row => row.id), ['safe']);
});

test('preview tokens use thumbnail audience, image dimensions, domain restriction, and paid-period expiry', async () => {
  const keys = ['MUX_TOKEN_ID', 'MUX_TOKEN_SECRET', 'MUX_SIGNING_KEY', 'MUX_PRIVATE_KEY', 'MUX_PLAYBACK_RESTRICTION_ID', 'APP_URL'];
  const old = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, { MUX_TOKEN_ID: 'fixture', MUX_TOKEN_SECRET: 'fixture', MUX_SIGNING_KEY: 'fixture', MUX_PRIVATE_KEY: 'fixture', MUX_PLAYBACK_RESTRICTION_ID: 'restriction', APP_URL: 'https://example.com' });
  const signed = [];
  class MuxMock {
    video = { playbackRestrictions: { retrieve: async () => ({ id: 'restriction', referrer: { allowed_domains: ['example.com'], allow_no_referrer: false }, user_agent: { allow_no_user_agent: false, allow_high_risk_user_agent: false } }) } };
    jwt = { signPlaybackId: async (id, options) => { signed.push({ id, ...options }); return 'signed'; } };
  }
  try {
    const { theatreThumbnails } = createLoader({ '@mux/ts': MuxMock })('server/theatre/mux.ts');
    const previews = await theatreThumbnails([{ id: 'safe', playbackId: 'drm' }, { id: 'missing', playbackId: null }], new Date(Date.now() + 60000));
    assert.equal(signed.length, 1);
    assert.equal(signed[0].type, 'thumbnail');
    assert.ok(parseInt(signed[0].expiration) <= 60);
    assert.deepEqual(signed[0].params, { playback_restriction_id: 'restriction', width: '640', height: '360', fit_mode: 'crop' });
    assert.deepEqual(previews, { safe: 'https://image.mux.com/drm/thumbnail.webp?token=signed' });
    await assert.rejects(theatreThumbnails([{ id: 'safe', playbackId: 'drm' }], new Date(Date.now() - 1)));
  } finally { for (const key of keys) { if (old[key] === undefined) delete process.env[key]; else process.env[key] = old[key]; } }
});
