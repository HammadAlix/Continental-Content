/* eslint-disable @typescript-eslint/no-require-imports -- Isolated catalogue regression tests. */
const test = require('node:test');
const assert = require('node:assert/strict');
const createLoader = require('./office-loader.cjs');

function fixture() {
  const rows = new Map();
  let asset = { id: 'asset_1', status: 'ready', playback_ids: [{ policy: 'drm', id: 'drm_1' }], meta: { title: 'First title' } };
  let failure;
  const schema = Object.fromEntries(['id', 'muxAssetId', 'title', 'status', 'playbackId', 'published'].map(k => [k, k]));
  const apply = (row, set) => Object.assign(row, Object.fromEntries(Object.entries(set).map(([k, v]) => [k, typeof v === 'function' ? v(row) : v])));
  const database = {
    update: () => ({ set: value => ({ where: async condition => { for (const row of rows.values()) if (condition(row)) apply(row, value); } }) }),
    insert: () => ({ values: value => ({ onConflictDoUpdate: async options => {
      const row = rows.get(value.muxAssetId);
      if (!row) rows.set(value.muxAssetId, { ...value });
      else if (!options.setWhere || options.setWhere(row)) apply(row, options.set);
    } }) }),
  };
  class MuxMock { video = { assets: { retrieve: async () => { if (failure) throw failure; return structuredClone(asset); } } }; }
  const load = createLoader({
    '@mux/ts': MuxMock,
    '@/server/db/client': { db: () => database },
    '@/server/db/schema': { theatreVideos: schema },
    'drizzle-orm': {
      eq: (key, value) => row => row[key] === value,
      ne: (key, value) => row => row[key] !== value,
      and: (...conditions) => row => conditions.every(condition => condition(row)),
      sql: (strings, ...values) => row => row[values[0]] === values[1] ? true : row[values[2]],
    },
  });
  return { rows, module: load('server/theatre/catalogue.ts'), asset: value => { asset = value; }, fail: value => { failure = value; } };
}

async function configured(callback) {
  const keys = ['MUX_TOKEN_ID', 'MUX_TOKEN_SECRET', 'MUX_AUTO_IMPORT_ENABLED'];
  const old = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, { MUX_TOKEN_ID: 'fixture', MUX_TOKEN_SECRET: 'fixture', MUX_AUTO_IMPORT_ENABLED: 'true' });
  try { await callback(); } finally { for (const key of keys) { if (old[key] === undefined) delete process.env[key]; else process.env[key] = old[key]; } }
}

test('ready DRM imports once; title edits synchronize without overwriting descriptions or manual publication', () => configured(async () => {
  const f = fixture();
  await f.module.syncMuxCatalogueVideo('asset_1');
  await f.module.syncMuxCatalogueVideo('asset_1');
  assert.equal(f.rows.size, 1);
  assert.equal(f.rows.get('asset_1').published, true);
  assert.equal(f.rows.get('asset_1').isSample, false);
  f.asset({ id: 'asset_1', status: 'ready', playback_ids: [{ policy: 'drm', id: 'drm_1' }], meta: { title: '<script>plain text</script>' } });
  f.rows.get('asset_1').description = 'Keep description';
  await f.module.syncMuxCatalogueVideo('asset_1');
  assert.equal(f.rows.get('asset_1').title, '<script>plain text</script>'); // React renders as text, never HTML.
  assert.equal(f.rows.get('asset_1').description, 'Keep description');
  f.rows.get('asset_1').id = 'manual-entry';
  f.rows.get('asset_1').published = false;
  await f.module.syncMuxCatalogueVideo('asset_1');
  assert.equal(f.rows.get('asset_1').published, false);
}));

test('unprotected, mixed, downloadable, preparing and errored assets are never auto-imported', () => configured(async () => {
  for (const extra of [
    { playback_ids: [] }, { playback_ids: [{ policy: 'public', id: 'public' }] },
    { playback_ids: [{ policy: 'signed', id: 'signed' }] },
    { playback_ids: [{ policy: 'drm', id: 'drm' }, { policy: 'public', id: 'public' }] },
    { master_access: 'temporary' }, { mp4_support: 'capped-1080p' },
    { static_renditions: { status: 'preparing' } }, { static_renditions: { files: [{ id: 'download' }] } },
    { status: 'preparing' }, { status: 'errored' },
  ]) {
    const f = fixture();
    f.asset({ id: 'asset_1', status: 'ready', playback_ids: [{ policy: 'drm', id: 'drm' }], ...extra });
    await f.module.syncMuxCatalogueVideo('asset_1');
    assert.equal(f.rows.size, 0);
  }
}));

test('existing unsafe videos become unavailable and can recover, but deleted tombstones never resurrect', () => configured(async () => {
  const f = fixture();
  await f.module.syncMuxCatalogueVideo('asset_1');
  f.asset({ id: 'asset_1', status: 'errored' });
  await f.module.syncMuxCatalogueVideo('asset_1');
  assert.equal(f.rows.get('asset_1').status, 'unavailable');
  assert.equal(f.rows.get('asset_1').playbackId, null);
  f.asset({ id: 'asset_1', status: 'ready', playback_ids: [{ policy: 'drm', id: 'drm' }] });
  await f.module.syncMuxCatalogueVideo('asset_1');
  assert.equal(f.rows.get('asset_1').status, 'ready');
  await f.module.deleteMuxCatalogueVideo('asset_1');
  await f.module.syncMuxCatalogueVideo('asset_1');
  assert.equal(f.rows.get('asset_1').status, 'deleted');
  assert.equal(f.rows.get('asset_1').published, false);
  assert.equal(f.rows.get('asset_1').playbackId, null);
  const early = fixture();
  await early.module.deleteMuxCatalogueVideo('asset_1');
  await early.module.syncMuxCatalogueVideo('asset_1');
  assert.equal(early.rows.get('asset_1').status, 'deleted');
}));

test('provider outages retry; missing provider assets become tombstones; import switch and ID checks fail closed', () => configured(async () => {
  const f = fixture();
  f.fail(Object.assign(new Error('Provider unavailable'), { status: 503 }));
  await assert.rejects(f.module.syncMuxCatalogueVideo('asset_1'));
  assert.equal(f.rows.size, 0);
  f.fail(Object.assign(new Error('Missing'), { status: 404 }));
  await f.module.syncMuxCatalogueVideo('asset_1');
  assert.equal(f.rows.get('asset_1').status, 'deleted');
  await assert.rejects(f.module.syncMuxCatalogueVideo('../wrong'));
  const disabled = fixture();
  process.env.MUX_AUTO_IMPORT_ENABLED = 'false';
  await disabled.module.syncMuxCatalogueVideo('asset_1');
  assert.equal(disabled.rows.size, 0);
  disabled.asset({ id: 'different', status: 'ready' });
  await assert.rejects(disabled.module.syncMuxCatalogueVideo('asset_1'));
}));
