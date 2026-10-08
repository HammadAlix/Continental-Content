// Real Mux create/rename/delete notifications. Creates and removes ONE short DRM fixture.
import Mux from '@mux/ts';
import { neon } from '@neondatabase/serverless';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

if (process.env.MUX_AUTO_IMPORT_ENABLED !== 'true') throw new Error('Enable local automatic import first.');
const mux = new Mux({ maxRetries: 0, timeout: 20000 });
const sql = neon(process.env.DATABASE_URL);
const marker = `catalogue-fixture-${randomUUID()}`;
const firstTitle = `Upload test ${marker}`, secondTitle = `Renamed ${marker}`;
let asset, deleted = false;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(predicate) {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    const rows = await sql`select id,title,status,published,is_sample,playback_id from theatre_videos where mux_asset_id=${asset.id}`;
    if (rows.length > 1) throw new Error('Duplicate catalogue import');
    if (rows[0] && predicate(rows[0])) return rows[0];
    await pause(1500);
  }
  throw new Error('Timed out waiting for automatic catalogue update.');
}
try {
  const health = await fetch('http://localhost:3000/api/mux/webhook', {
    method: 'POST', body: '{}', signal: AbortSignal.timeout(30000),
  });
  if (health.status !== 400) throw new Error('Local webhook must be running and reject unsigned requests before testing.');
  const [source] = await sql`select mux_asset_id from theatre_videos where id='sample-screening'`;
  if (!source) throw new Error('Sample source missing.');
  asset = await mux.video.assets.create({
    inputs: [{ url: `mux://assets/${source.mux_asset_id}`, start_time: 0, end_time: 2 }],
    video_quality: 'plus', max_resolution_tier: '1080p', master_access: 'none', passthrough: marker,
    meta: { title: firstTitle },
    advanced_playback_policies: [{ policy: 'drm', drm_configuration_id: process.env.MUX_DRM_CONFIGURATION_ID }],
  });
  console.log('Created short DRM fixture in Mux only; no database row inserted by this script.');
  const imported = await waitFor(row => row.title === firstTitle && row.status === 'ready' && row.published && row.playback_id);
  assert.equal(imported.id, `mux-${asset.id}`);
  assert.equal(imported.is_sample, false);
  console.log('PASS: real ready webhook automatically imported and published exactly one DRM screening.');
  await mux.video.assets.update(asset.id, { meta: { title: secondTitle } });
  await waitFor(row => row.title === secondTitle && row.status === 'ready' && row.published);
  console.log('PASS: real Mux title-update notification renamed the same catalogue entry.');
  await mux.video.assets.delete(asset.id);
  deleted = true;
  await waitFor(row => row.status === 'deleted' && !row.published && row.playback_id === null);
  console.log('PASS: real deletion removed the screening from published/ready listings and cleared playback access.');
} catch (error) {
  console.error('Catalogue test incomplete: ' + (error.status ? `provider HTTP ${error.status}` : error.message));
  process.exitCode = 1;
} finally {
  try {
    if (asset && !deleted) { await mux.video.assets.delete(asset.id); await pause(5000); }
    if (asset) await sql`delete from theatre_videos where mux_asset_id=${asset.id} and id=${`mux-${asset.id}`}`;
    console.log('Cleanup: only this temporary Mux clip and its imported row removed. Existing videos unchanged.');
  } catch {
    console.error('Temporary catalogue fixture cleanup needs review.');
    process.exitCode = 1;
  }
}
