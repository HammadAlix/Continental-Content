// Operator-only setup, never exposed as a public HTTP route. No secret output.
import Mux from '@mux/ts';
import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

const createSample = process.argv.includes('--create-sample');
const client = new Mux({ timeout: 30000, maxRetries: 0 });
const sql = neon(process.env.DATABASE_URL);
const envPath = path.resolve('.env.local');

function saveSettings(values) {
  const original = readFileSync(envPath, 'utf8');
  const additions = Object.entries(values).filter(([key]) => !new RegExp(`^${key}=`, 'm').test(original));
  if (!additions.length) return;
  const patch = `*** Begin Patch\n*** Update File: ${envPath.replaceAll('\\', '/')}\n@@\n${additions.map(([key, value]) => `+${key}=${value}`).join('\n')}\n*** End Patch`;
  const executable = process.env.CODEX_APPLY_PATCH_BIN;
  if (!executable) throw new Error('Set CODEX_APPLY_PATCH_BIN to the installed patch helper before provisioning.');
  const result = spawnSync(executable, ['--codex-run-as-apply-patch', patch], { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error('Could not save private configuration. Review newly created signing keys in Mux; do not rerun blindly.');
  for (const [key, value] of additions) process.env[key] = value;
}

try {
  if (!process.env.MUX_DRM_CONFIGURATION_ID) throw new Error('DRM configuration is missing.');
  const configs = await client.video.drmConfigurations.list({ limit: 100 });
  if (!configs.data.some(item => item.id === process.env.MUX_DRM_CONFIGURATION_ID)) throw new Error('DRM configuration does not belong to this environment.');
  console.log('API access and matching DRM configuration verified.');
  if (!createSample) process.exit(0);
  if (!process.env.CODEX_APPLY_PATCH_BIN) throw new Error('Patch helper is required to save generated credentials.');
  if (Boolean(process.env.MUX_SIGNING_KEY) !== Boolean(process.env.MUX_PRIVATE_KEY)) throw new Error('Partial signing credentials: reconcile manually.');
  if (!process.env.MUX_SIGNING_KEY) {
    const key = await client.system.signingKeys.create();
    if (!key.private_key) throw new Error('Signing private key was not returned.');
    saveSettings({ MUX_SIGNING_KEY: key.id, MUX_PRIVATE_KEY: key.private_key });
    console.log('Signing key created and saved privately.');
  }
  // Local test secret only. Use Mux dashboard-generated endpoint secret on deployment.
  saveSettings({ MUX_WEBHOOK_SECRET: randomBytes(32).toString('hex') });
  const saved = await sql`select mux_asset_id from theatre_videos where id = 'sample-screening'`;
  let asset;
  if (saved.length) asset = await client.video.assets.retrieve(saved[0].mux_asset_id);
  else {
    let checked = 0;
    for await (const candidate of client.video.assets.list({ limit: 100 })) {
      if (candidate.passthrough === 'continental-theatre-sample-v1') { asset = candidate; break; }
      if (++checked > 1000) throw new Error('Too many assets to safely reconcile sample creation.');
    }
    if (!asset) {
      asset = await client.video.assets.create({
        inputs: [{ url: 'https://storage.googleapis.com/muxdemofiles/mux-video-intro.mp4' }],
        video_quality: 'plus', max_resolution_tier: '1080p',
        master_access: 'none',
        advanced_playback_policies: [{ policy: 'drm', drm_configuration_id: process.env.MUX_DRM_CONFIGURATION_ID }],
        passthrough: 'continental-theatre-sample-v1',
      });
      console.log('One Mux demonstration video submitted with DRM (Plus, up to 1080p).');
    }
  }
  const playback = asset.playback_ids?.find(id => id.policy === 'drm');
  const safe = !asset.playback_ids?.some(id => id.policy !== 'drm') &&
    asset.master_access !== 'temporary' && (!asset.mp4_support || asset.mp4_support === 'none') &&
    !(asset.static_renditions?.files?.length) && !['ready', 'preparing'].includes(asset.static_renditions?.status);
  if (!safe) throw new Error('Sample has unprotected playback; publishing refused.');
  await sql`insert into theatre_videos (id,title,description,mux_asset_id,playback_id,status,published,is_sample)
    values ('sample-screening','Theatre sample screening','Demonstration clip for protected playback. Not final client content.',${asset.id},${playback?.id || null},${asset.status},true,true)
    on conflict (id) do update set playback_id = excluded.playback_id, status = excluded.status`;
  console.log('Sample registered in the local-configured database. Status: ' + asset.status);
  console.log('No live Stripe payments enabled. No deployment performed.');
} catch (error) {
  // Provider errors may contain request metadata; never dump the error object.
  console.error(error?.status ? `Mux setup failed: HTTP ${error.status}. Check token permissions and DRM activation.` : 'Setup incomplete: ' + error.message);
  process.exitCode = 1;
}
