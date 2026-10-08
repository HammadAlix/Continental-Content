/* eslint-disable @typescript-eslint/no-require-imports -- Isolated security tests. */
const test = require('node:test');
const assert = require('node:assert/strict');
const createLoader = require('./office-loader.cjs');

test('playback denies anonymous and unpaid viewers before accessing video or signing', async () => {
  for (const anonymous of [true, false]) {
    let muxCalls = 0;
    const load = createLoader({
      '@/server/theatre/http': {
        theatreRequest: async () => anonymous ? { response: new Response(null, { status: 401 }) } : { member: { id: 'user_test' } },
        theatreJson: (body, status = 200) => Response.json(body, { status }),
      },
      '@/server/theatre/membership': { getMembership: async () => ({ active: false }) },
      '@/server/theatre/mux': { protectedAssetPlayback: () => { muxCalls++; } },
      '@/server/db/client': { db: () => { throw new Error('Must not access video database'); } },
    });
    const route = load('app/api/theatre/playback/[id]/route.ts');
    const response = await route.POST(new Request('http://localhost/api/theatre/playback/example', { method: 'POST' }), { params: Promise.resolve({ id: 'example' }) });
    assert.equal(response.status, anonymous ? 401 : 403);
    assert.equal(muxCalls, 0);
  }
});

test('Mux asset containing public or ordinary signed playback never passes DRM verification', async () => {
  for (const ids of [[{ policy: 'public', id: 'public' }], [{ policy: 'signed', id: 'signed' }],
    [{ policy: 'drm', id: 'drm' }, { policy: 'public', id: 'public' }], [{ policy: 'drm', id: 'drm' }]]) {
    let saved;
    class MuxMock { video = { assets: { retrieve: async () => ({ status: 'ready', playback_ids: ids }) } }; }
    const load = createLoader({
      '@mux/ts': MuxMock,
      '@/server/db/client': { db: () => ({ update: () => ({ set: value => { saved = value; return { where: async () => {} }; } }) }) },
    });
    const previousId = process.env.MUX_TOKEN_ID, previousSecret = process.env.MUX_TOKEN_SECRET;
    process.env.MUX_TOKEN_ID = 'fixture'; process.env.MUX_TOKEN_SECRET = 'fixture';
    try {
      const playback = await load('server/theatre/mux.ts').syncTheatreVideo('fixture');
      const valid = ids.length === 1 && ids[0].policy === 'drm';
      assert.equal(playback, valid ? 'drm' : null);
      assert.equal(saved.status, valid ? 'ready' : 'unavailable');
    } finally {
      if (previousId === undefined) delete process.env.MUX_TOKEN_ID; else process.env.MUX_TOKEN_ID = previousId;
      if (previousSecret === undefined) delete process.env.MUX_TOKEN_SECRET; else process.env.MUX_TOKEN_SECRET = previousSecret;
    }
  }
});

test('playback tokens expire within five minutes and never beyond paid access', async () => {
  const previous = { ...process.env };
  Object.assign(process.env, { MUX_TOKEN_ID: 'fixture', MUX_TOKEN_SECRET: 'fixture', MUX_SIGNING_KEY: 'fixture', MUX_PRIVATE_KEY: 'fixture', MUX_PLAYBACK_RESTRICTION_ID: 'restriction', APP_URL: 'https://example.com' });
  const expirations = [];
  class MuxMock { video = { playbackRestrictions: { retrieve: async () => strictRestriction() } }; jwt = {
    signPlaybackId: async (id, options) => { expirations.push(options.expiration); return 'fake'; },
    signDrmLicense: async (id, options) => { expirations.push(options.expiration); return 'fake'; },
  }; }
  try {
    const { playbackTokens } = createLoader({ '@mux/ts': MuxMock })('server/theatre/mux.ts');
    await playbackTokens('drm', new Date(Date.now() + 60000));
    assert.equal(expirations.length, 4);
    assert.ok(expirations.every(value => parseInt(value) > 0 && parseInt(value) <= 60));
    await assert.rejects(playbackTokens('drm', new Date(Date.now() - 1)));
    await assert.rejects(playbackTokens('drm', new Date(NaN)));
    expirations.length = 0;
    await playbackTokens('drm', new Date(Date.now() + 3600000));
    assert.ok(expirations.every(value => value === '300s'));
  } finally {
    for (const key of ['MUX_TOKEN_ID', 'MUX_TOKEN_SECRET', 'MUX_SIGNING_KEY', 'MUX_PRIVATE_KEY', 'MUX_PLAYBACK_RESTRICTION_ID', 'APP_URL']) {
      if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
    }
  }
});

function strictRestriction() {
  return { id: 'restriction', referrer: { allowed_domains: ['example.com'], allow_no_referrer: false },
    user_agent: { allow_no_user_agent: false, allow_high_risk_user_agent: false } };
}

test('every video, DRM, thumbnail and storyboard token includes the verified website restriction', async () => {
  const previous = { ...process.env };
  Object.assign(process.env, { MUX_TOKEN_ID: 'fixture', MUX_TOKEN_SECRET: 'fixture', MUX_SIGNING_KEY: 'fixture', MUX_PRIVATE_KEY: 'fixture', MUX_PLAYBACK_RESTRICTION_ID: 'restriction', APP_URL: 'https://example.com' });
  const signed = [];
  let policy = strictRestriction();
  let fail = false;
  class MuxMock {
    video = { playbackRestrictions: { retrieve: async () => { if (fail) throw new Error('provider unavailable'); return policy; } } };
    jwt = { signPlaybackId: async (id, options) => { signed.push(options); return 'fake'; },
      signDrmLicense: async (id, options) => { signed.push(options); return 'fake'; } };
  }
  try {
    const { playbackTokens } = createLoader({ '@mux/ts': MuxMock })('server/theatre/mux.ts');
    const future = new Date(Date.now() + 3600000);
    await playbackTokens('drm', future);
    assert.equal(signed.length, 4);
    assert.ok(signed.every(options => options.params.playback_restriction_id === 'restriction'));
    // Mux omits false for referrer; unlike user-agent fields its default is false.
    delete policy.referrer.allow_no_referrer;
    await playbackTokens('drm', future);
    for (const weaken of [p => p.id = 'wrong', p => p.referrer.allowed_domains = ['*'],
      p => p.referrer.allowed_domains.push('untrusted.com'), p => p.referrer.allow_no_referrer = true,
      p => p.user_agent.allow_no_user_agent = true, p => p.user_agent.allow_high_risk_user_agent = true,
      p => delete p.user_agent.allow_no_user_agent]) {
      policy = strictRestriction(); weaken(policy); signed.length = 0;
      await assert.rejects(playbackTokens('drm', future));
      assert.equal(signed.length, 0);
    }
    policy = strictRestriction(); fail = true;
    await assert.rejects(playbackTokens('drm', future));
    fail = false; delete process.env.MUX_PLAYBACK_RESTRICTION_ID;
    await assert.rejects(playbackTokens('drm', future));
  } finally {
    for (const key of ['MUX_TOKEN_ID', 'MUX_TOKEN_SECRET', 'MUX_SIGNING_KEY', 'MUX_PRIVATE_KEY', 'MUX_PLAYBACK_RESTRICTION_ID', 'APP_URL']) {
      if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
    }
  }
});

test('DRM assets with master downloads or static renditions are rejected without deleting provider assets', async () => {
  const previous = { ...process.env };
  Object.assign(process.env, { MUX_TOKEN_ID: 'fixture', MUX_TOKEN_SECRET: 'fixture' });
  try {
    for (const extra of [{ master_access: 'temporary' }, { mp4_support: 'standard' },
      { static_renditions: { files: [{ status: 'preparing' }] } }, { static_renditions: { status: 'ready' } },
      { status: 'preparing' }]) {
      let saved;
      class MuxMock { video = { assets: { retrieve: async () => ({ status: 'ready', playback_ids: [{ id: 'drm', policy: 'drm' }], ...extra }) } }; }
      const load = createLoader({ '@mux/ts': MuxMock,
        '@/server/db/client': { db: () => ({ update: () => ({ set: value => { saved = value; return { where: async () => {} }; } }) }) } });
      assert.equal(await load('server/theatre/mux.ts').syncTheatreVideo('fixture'), null);
      assert.equal(saved.playbackId, null);
    }
  } finally {
    for (const key of ['MUX_TOKEN_ID', 'MUX_TOKEN_SECRET']) {
      if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
    }
  }
});
