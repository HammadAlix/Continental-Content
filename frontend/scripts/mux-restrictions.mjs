// Operator-only. Read-only by default; --configure creates/reuses a restriction.
// Never updates or deletes an existing provider policy or prints credentials.
import Mux from '@mux/ts';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const configure = process.argv.includes('--configure');
const client = new Mux({ timeout: 15000, maxRetries: 0 });
let phase = 'configuration';

try {
  if (!process.env.APP_URL) throw new Error('Set APP_URL to the exact website origin first.');
  const origin = new URL(process.env.APP_URL);
  const local = ['localhost', '127.0.0.1'].includes(origin.hostname);
  if ((origin.protocol !== 'https:' && !(local && origin.protocol === 'http:')) ||
    origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) {
    throw new Error('APP_URL must be an HTTPS website origin (HTTP allowed for localhost only).');
  }
  const expected = {
    referrer: { allowed_domains: [origin.hostname], allow_no_referrer: false },
    user_agent: { allow_no_user_agent: false, allow_high_risk_user_agent: false },
  };
  const matches = policy => policy.referrer?.allowed_domains?.length === 1 &&
    policy.referrer.allowed_domains[0] === origin.hostname &&
    (policy.referrer.allow_no_referrer === false || policy.referrer.allow_no_referrer === undefined) &&
    policy.user_agent?.allow_no_user_agent === false && policy.user_agent.allow_high_risk_user_agent === false;
  const savedId = process.env.MUX_PLAYBACK_RESTRICTION_ID;
  if (savedId) {
    if (!matches(await client.video.playbackRestrictions.retrieve(savedId))) {
      throw new Error('Saved policy does not match APP_URL or strict browser rules. Existing policy was NOT changed.');
    }
    console.log('Saved playback restriction verified for ' + origin.hostname);
  } else if (!configure) {
    console.log('Playback restriction is missing. Use --configure to create/reuse a strict policy for ' + origin.hostname);
    process.exitCode = 1;
  } else {
    const helper = process.env.CODEX_APPLY_PATCH_BIN;
    if (!helper) throw new Error('Set CODEX_APPLY_PATCH_BIN before provisioning.');
    const envPath = path.resolve('.env.local');
    const original = readFileSync(envPath, 'utf8');
    if (/^\s*(?:export\s+)?MUX_PLAYBACK_RESTRICTION_ID\s*=/m.test(original)) {
      throw new Error('An existing environment entry needs operator review; not overwriting it.');
    }
    let policy;
    phase = 'find existing policy';
    let checked = 0;
    for await (const candidate of client.video.playbackRestrictions.list({ limit: 100 })) {
      if (matches(candidate)) { policy = candidate; break; }
      if (++checked >= 1000) throw new Error('Too many policies to safely reconcile automatically.');
    }
    phase = 'create policy';
    if (!policy) policy = await client.video.playbackRestrictions.create(expected);
    if (!matches(policy)) throw new Error('Provider returned an unexpected policy; configuration was not saved.');
    const patch = `*** Begin Patch\n*** Update File: ${envPath.replaceAll('\\', '/')}\n@@\n+MUX_PLAYBACK_RESTRICTION_ID=${policy.id}\n*** End Patch`;
    phase = 'save local configuration';
    const result = spawnSync(helper, ['--codex-run-as-apply-patch', patch], { encoding: 'utf8', windowsHide: true });
    if (result.status !== 0) {
      console.error('Patch helper status: ' + result.status + '; error code: ' + (result.error?.code ?? 'none'));
      throw new Error('Could not save restriction. Inspect existing policies before retrying.');
    }
    console.log('Strict playback restriction saved privately for ' + origin.hostname);
    console.log('Other sites, missing referrers, missing user agents and Mux high-risk user agents are denied.');
  }
} catch (error) {
  if (error?.status) console.error('Mux restriction check failed: HTTP ' + error.status + '. Check Video permissions.');
  else console.error('Mux restriction setup failed during ' + phase + '. No credentials printed.');
  process.exitCode = 1;
}
