/* eslint-disable @typescript-eslint/no-require-imports -- Isolated tests; no live providers or database. */
const test = require('node:test');
const assert = require('node:assert/strict');
const createLoader = require('./office-loader.cjs');

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
const safeAsset = () => ({ status: 'ready', playback_ids: [{ id: 'drm', policy: 'drm' }] });
const strictPolicy = () => ({ id: 'restriction', referrer: { allowed_domains: ['example.com'], allow_no_referrer: false },
  user_agent: { allow_no_user_agent: false, allow_high_risk_user_agent: false } });

async function fixture(run) {
  const values = { MUX_TOKEN_ID: 'fixture', MUX_TOKEN_SECRET: 'fixture', MUX_SIGNING_KEY: 'fixture',
    MUX_PRIVATE_KEY: 'fixture', MUX_PLAYBACK_RESTRICTION_ID: 'restriction', APP_URL: 'https://example.com' };
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  const calls = [], signed = [];
  const asset = deferred(), policy = deferred(), saved = deferred();
  class MuxMock {
    video = {
      assets: { retrieve: () => { calls.push('asset'); return asset.promise; } },
      playbackRestrictions: { retrieve: () => { calls.push('policy'); return policy.promise; } },
    };
    jwt = {
      signPlaybackId: async (id, options) => { signed.push({ id, ...options }); return 'fake'; },
      signDrmLicense: async (id, options) => { signed.push({ id, ...options }); return 'fake'; },
    };
  }
  const muxHelpers = createLoader({ '@mux/ts': MuxMock,
    '@/server/db/client': { db: () => ({ update: () => ({ set: () => ({ where: () => { calls.push('save'); return saved.promise; } }) }) }) },
  })('server/theatre/mux.ts');
  try { await run({ ...muxHelpers, calls, signed, asset, policy, saved }); }
  finally { for (const key of Object.keys(values)) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; } }
}

test('Mux checks overlap but signing waits for BOTH checks and the database update', async () => {
  await fixture(async f => {
    const pending = f.protectedAssetPlayback('asset', new Date(Date.now() + 60000));
    assert.deepEqual(f.calls, ['asset', 'policy']);
    f.policy.resolve(strictPolicy());
    await flush();
    assert.equal(f.signed.length, 0);
    f.asset.resolve(safeAsset());
    await flush();
    assert.deepEqual(f.calls, ['asset', 'policy', 'save']);
    assert.equal(f.signed.length, 0);
    f.saved.resolve();
    assert.equal((await pending).playbackId, 'drm');
    assert.equal(f.signed.length, 4);
    assert.ok(f.signed.every(token => token.params.playback_restriction_id === 'restriction' && parseInt(token.expiration) <= 60));
    await f.protectedAssetPlayback('asset', new Date(Date.now() + 60000));
    assert.equal(f.calls.filter(call => call === 'asset').length, 2, 'No cached asset decision on renewal');
    assert.equal(f.calls.filter(call => call === 'policy').length, 2, 'No cached restriction decision on renewal');
  });
});

test('asset completion alone cannot issue playback tokens', async () => {
  await fixture(async f => {
    const pending = f.protectedAssetPlayback('asset', new Date(Date.now() + 60000));
    f.asset.resolve(safeAsset()); f.saved.resolve();
    await flush();
    assert.equal(f.signed.length, 0);
    f.policy.resolve(strictPolicy());
    assert.equal((await pending).playbackId, 'drm');
  });
});

test('provider failures, weakened restrictions and database errors never issue tokens', async () => {
  for (const failure of ['asset', 'policy', 'save', 'weakened-policy', 'both-providers']) {
    await fixture(async f => {
      const pending = f.protectedAssetPlayback('asset', new Date(Date.now() + 60000));
      const denied = assert.rejects(pending);
      if (['asset', 'both-providers'].includes(failure)) f.asset.reject(new Error('asset unavailable'));
      else f.asset.resolve(safeAsset());
      if (['policy', 'both-providers'].includes(failure)) f.policy.reject(new Error('policy unavailable'));
      else f.policy.resolve(failure === 'weakened-policy' ? { ...strictPolicy(), referrer: { allowed_domains: ['*'] } } : strictPolicy());
      // Wait until the asset path has attached its database continuation.
      await flush();
      if (failure === 'save') f.saved.reject(new Error('database unavailable'));
      else f.saved.resolve();
      await denied;
      await flush();
      assert.equal(f.signed.length, 0, failure);
    });
  }
});

test('unsafe assets and membership expiry during provider checks still block signing', async () => {
  await fixture(async f => {
    const pending = f.protectedAssetPlayback('asset', new Date(Date.now() + 60000));
    f.asset.resolve({ ...safeAsset(), master_access: 'temporary' });
    f.policy.resolve(strictPolicy()); f.saved.resolve();
    assert.equal(await pending, null);
    assert.equal(f.signed.length, 0);
  });
  await fixture(async f => {
    const paidThrough = new Date(Date.now() + 60000);
    const pending = f.protectedAssetPlayback('asset', paidThrough);
    const denied = assert.rejects(pending, /Membership expired/);
    paidThrough.setTime(Date.now() - 1);
    f.asset.resolve(safeAsset()); f.policy.resolve(strictPolicy()); f.saved.resolve();
    await denied;
    assert.equal(f.signed.length, 0);
  });
});

test('route preserves auth/rate-limit, fresh membership, and published-video gates before Mux', async () => {
  for (const scenario of ['anonymous', 'rate-limited', 'unpaid', 'membership-failure', 'missing-video', 'unsafe-video', 'mux-failure', 'allowed']) {
    const calls = [];
    const route = createLoader({
      '@/server/theatre/http': {
        theatreRequest: async () => {
          calls.push('gate');
          return ['anonymous', 'rate-limited'].includes(scenario)
            ? { response: Response.json({}, { status: scenario === 'anonymous' ? 401 : 429 }) }
            : { member: { id: 'member' } };
        },
        theatreJson: (body, status = 200) => Response.json(body, { status }),
      },
      '@/server/theatre/membership': { getMembership: async id => {
        assert.equal(id, 'member'); calls.push('fresh-membership');
        if (scenario === 'membership-failure') throw new Error('Stripe unavailable');
        return { active: scenario !== 'unpaid', paidThrough: new Date(Date.now() + 60000) };
      } },
      '@/server/db/schema': { theatreVideos: { id: 'id', published: 'published' } },
      'drizzle-orm': { eq: (key, value) => row => row[key] === value, and: (...predicates) => row => predicates.every(p => p(row)) },
      '@/server/db/client': { db: () => ({ select: () => ({ from: () => ({ where: async predicate => {
        calls.push('video');
        const rows = [{ id: 'video', published: scenario !== 'missing-video', muxAssetId: 'asset' },
          { id: 'other', published: true, muxAssetId: 'other-asset' }];
        return rows.filter(predicate);
      } }) }) }) },
      '@/server/theatre/mux': { protectedAssetPlayback: async (asset, paidThrough) => {
        calls.push('mux'); assert.equal(asset, 'asset'); assert.ok(paidThrough > new Date());
        if (scenario === 'mux-failure') throw new Error('Mux unavailable');
        return scenario === 'unsafe-video' ? null : { playbackId: 'drm', tokens: { playback: 'fake' } };
      } },
    })('app/api/theatre/playback/[id]/route.ts');
    const response = await route.POST(new Request('http://localhost/api/theatre/playback/video', { method: 'POST' }), { params: Promise.resolve({ id: 'video' }) });
    const expected = { anonymous: 401, 'rate-limited': 429, unpaid: 403, 'membership-failure': 503, 'missing-video': 404,
      'unsafe-video': 409, 'mux-failure': 503, allowed: 200 };
    assert.equal(response.status, expected[scenario], scenario);
    const gates = ['gate', 'fresh-membership', 'video', 'mux'];
    const count = ['anonymous', 'rate-limited'].includes(scenario) ? 1 : ['unpaid', 'membership-failure'].includes(scenario) ? 2 : scenario === 'missing-video' ? 3 : 4;
    assert.deepEqual(calls, gates.slice(0, count));
    if (scenario !== 'allowed') assert.equal((await response.json()).tokens, undefined);
  }
});
