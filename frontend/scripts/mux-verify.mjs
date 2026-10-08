// Read-only integration probe. Requests small playlists/images, not a whole video.
// Never logs signed URLs, tokens, credentials, or provider response bodies.
import Mux from '@mux/ts';
import { neon } from '@neondatabase/serverless';
import { createPrivateKey, sign } from 'node:crypto';
const client = new Mux({ timeout: 15000, maxRetries: 0 });
const sql = neon(process.env.DATABASE_URL);
let phase = 'configuration';
try {
  const origin = new URL(process.env.APP_URL || 'http://localhost:3000').origin;
  const restrictionId = process.env.MUX_PLAYBACK_RESTRICTION_ID;
  if (!restrictionId) throw new Error('Missing restriction');
  phase = 'find sample';
  const [saved] = await sql`select mux_asset_id from theatre_videos where id = 'sample-screening'`;
  if (!saved) throw new Error('Sample not registered');
  const asset = await client.video.assets.retrieve(saved.mux_asset_id);
  const playbackId = asset.playback_ids?.find(item => item.policy === 'drm')?.id;
  if (asset.status !== 'ready' || !playbackId || asset.playback_ids.some(item => item.policy !== 'drm')) {
    console.log('Sample is not ready for DRM verification. Status: ' + asset.status);
    process.exit(1);
  }
  phase = 'sign tokens';
  const params = { playback_restriction_id: restrictionId };
  const valid = await client.jwt.signPlaybackId(playbackId, { expiration: '60s', params });
  // The SDK accepts positive durations only; sign a deliberately expired fixture.
  const [header, payload] = valid.split('.');
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
  claims.exp = Math.floor(Date.now() / 1000) - 60;
  const unsigned = header + '.' + Buffer.from(JSON.stringify(claims)).toString('base64url');
  const privateKey = createPrivateKey(Buffer.from(process.env.MUX_PRIVATE_KEY, 'base64'));
  const expired = unsigned + '.' + sign('RSA-SHA256', Buffer.from(unsigned), privateKey).toString('base64url');
  const parts = valid.split('.');
  parts[2] = (parts[2][0] === 'A' ? 'B' : 'A') + parts[2].slice(1);
  const browser = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
  const cases = [
    ['valid pass on allowed website', valid, origin, true],
    ['unsigned request', null, origin, false],
    ['expired pass', expired, origin, false],
    ['tampered pass', parts.join('.'), origin, false],
    ['different website', valid, 'https://not-continental.example', false],
    ['missing website referrer', valid, null, false],
  ];
  let failed = false;
  for (const [label, token, referrer, allow] of cases) {
    phase = label;
    const url = new URL(`https://stream.mux.com/${playbackId}.m3u8`);
    if (token) url.searchParams.set('token', token);
    const headers = { 'User-Agent': browser };
    if (referrer) headers.Referer = referrer + '/';
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
    const body = await response.text();
    const passed = allow ? response.status === 200 && body.startsWith('#EXTM3U') : [401, 403].includes(response.status);
    if (!passed) failed = true;
    console.log(JSON.stringify({ check: label, status: response.status, passed }));
  }
  console.log('This verifies stream authorization, NOT DRM licence exchange, visible playback or screen-capture blocking.');
  if (failed) process.exitCode = 1;
} catch (error) {
  console.error('Mux verification incomplete during ' + phase + (error?.status ? '; HTTP ' + error.status : '') + '. No secrets printed.');
  process.exitCode = 1;
}
