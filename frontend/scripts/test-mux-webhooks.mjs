// Real provider events for one unpublished, two-second DRM fixture. Normal Mux usage applies.
// Run only while a CLI listener for this same environment forwards to the local app.
import Mux from '@mux/ts';
import { neon } from '@neondatabase/serverless';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

const client = new Mux({ maxRetries: 0, timeout: 20000 });
const sql = neon(process.env.DATABASE_URL);
const fixture = `webhook-fixture-${randomUUID()}`;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let asset;
let deleted = false;
async function waitForRow(predicate) {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    const [row] = await sql`select status, playback_id from theatre_videos where id = ${fixture}`;
    if (row && predicate(row)) return row;
    await pause(1500);
  }
  throw new Error('Timed out waiting for webhook-only video synchronization.');
}
try {
  if (!process.env.MUX_DRM_CONFIGURATION_ID || !process.env.MUX_WEBHOOK_SECRET) throw new Error('DRM and local listener configuration required.');
  const [source] = await sql`select mux_asset_id from theatre_videos where id = 'sample-screening'`;
  if (!source) throw new Error('Existing sample asset required for a two-second fixture.');
  asset = await client.video.assets.create({
    inputs: [{ url: `mux://assets/${source.mux_asset_id}`, start_time: 0, end_time: 2 }],
    video_quality: 'plus', max_resolution_tier: '1080p', master_access: 'none', passthrough: fixture,
    advanced_playback_policies: [{ policy: 'drm', drm_configuration_id: process.env.MUX_DRM_CONFIGURATION_ID }],
  });
  await sql`insert into theatre_videos (id,title,description,mux_asset_id,status,published,is_sample)
    values (${fixture},'Disposable webhook fixture','Two-second local notification test',${asset.id},'preparing',false,true)`;
  console.log('Created one unpublished two-second DRM test asset; awaiting provider event.');
  const ready = await waitForRow(row => row.status === 'ready' && row.playback_id);
  assert.ok(ready.playback_id);
  console.log('PASS: real Mux asset-ready event updated the fixture database row through the local webhook.');
  await client.video.assets.delete(asset.id);
  deleted = true;
  await waitForRow(row => row.status === 'deleted' && row.playback_id === null);
  console.log('PASS: real Mux asset-deleted event removed playable access in the fixture row.');
} catch (error) {
  console.error('Mux webhook test incomplete: ' + (error.status ? `HTTP ${error.status}` : error.message));
  const messages = error.error?.error?.messages || error.error?.messages;
  if (Array.isArray(messages)) {
    let detail = messages.join('; ');
    for (const [key, value] of Object.entries(process.env)) {
      if (/KEY|TOKEN|SECRET|DATABASE|CONFIGURATION_ID/.test(key) && value?.length > 7) detail = detail.split(value).join('[redacted]');
    }
    console.error('Provider validation: ' + detail);
  }
  process.exitCode = 1;
} finally {
  try {
    if (asset && !deleted) await client.video.assets.delete(asset.id);
    await sql`delete from theatre_videos where id = ${fixture}`;
    console.log(asset ? 'Cleanup: only the disposable test asset and its database row removed; existing sample untouched.' : 'No test asset created; existing sample untouched.');
  } catch { console.error('Disposable Mux fixture cleanup needs review.'); process.exitCode = 1; }
}
