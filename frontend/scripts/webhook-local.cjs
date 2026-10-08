/* eslint-disable @typescript-eslint/no-require-imports -- Standalone local CLI runner. */
/* Local CLI forwarding only. Never prints API keys or webhook signing secrets. */
const { spawn, spawnSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const provider = process.argv[2];
if (!['stripe', 'mux'].includes(provider)) throw new Error('Choose stripe or mux.');
if (!process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_')) throw new Error('Test Stripe configuration required.');
const patchBin = process.env.CODEX_APPLY_PATCH_BIN;
if (!patchBin) throw new Error('Set CODEX_APPLY_PATCH_BIN to the installed Codex patch helper.');
const envFile = path.resolve('.env.local');
const endpoint = `http://localhost:3000/api/${provider}/webhook`;
const childEnv = { ...process.env, STRIPE_API_KEY: process.env.STRIPE_SECRET_KEY, NO_COLOR: '1' };
// Explicit opt-in: let Mux use its saved browser login instead of the app's video-only token.
if (provider === 'mux' && process.argv.includes('--saved-login')) {
  delete childEnv.MUX_TOKEN_ID; delete childEnv.MUX_TOKEN_SECRET;
}
const executable = provider === 'stripe'
  ? path.join(process.env.APPDATA, 'npm/node_modules/@stripe/cli/node_modules/@stripe/cli-win32-x64/bin/stripe.exe')
  : process.env.MUX_CLI_PATH || path.join(process.env.LOCALAPPDATA, 'ContinentalContentTools/mux/mux.exe');
if (!executable) throw new Error('Set MUX_CLI_PATH to the local Mux CLI executable.');
const args = provider === 'stripe'
  ? ['listen', '--forward-to', endpoint, '--events', 'customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,invoice.paid,invoice.payment_failed,checkout.session.completed', '--skip-update', '--color', 'off']
  : ['webhooks', 'listen', '--forward-to', endpoint];
let saved = false;
function saveSecret(secret) {
  if (saved) return;
  const key = provider === 'stripe' ? 'STRIPE_WEBHOOK_SECRET' : 'MUX_WEBHOOK_SECRET';
  const original = readFileSync(envFile, 'utf8');
  const old = original.match(new RegExp(`^${key}=.*`, 'm'))?.[0];
  if (old?.trimEnd() !== `${key}=${secret}`) {
    const patch = `*** Begin Patch\n*** Update File: ${envFile.replaceAll('\\', '/')}\n@@\n${old ? '-' + old.trimEnd() + '\n' : ''}+${key}=${secret}\n*** End Patch`;
    const result = spawnSync(patchBin, ['--codex-run-as-apply-patch', patch], { windowsHide: true, encoding: 'utf8' });
    if (result.status !== 0) throw new Error('Could not privately update local webhook secret.');
  }
  saved = true;
  console.log(`${provider}: listener secret saved privately in .env.local.`);
}
// Bun-built executables auto-load .env.local from cwd. A neutral cwd is required
// for --saved-login; otherwise the removed video-only token is loaded again.
const child = spawn(executable, args, {
  cwd: provider === 'mux' && process.argv.includes('--saved-login') ? path.dirname(executable) : process.cwd(),
  env: childEnv, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
});
function consume(stream) {
  let buffer = '';
  stream.on('data', chunk => {
    buffer += chunk.toString();
    const lines = buffer.split(/[\r\n]+/); buffer = lines.pop();
    for (const line of lines) {
      const clean = line.replace(/\x1b\[[0-9;]*m/g, '');
      try {
        const secret = provider === 'stripe' ? clean.match(/whsec_[A-Za-z0-9]+/)?.[0]
          : clean.match(/Webhook signing secret:\s*([a-f0-9]{32,})/i)?.[1];
        if (secret) saveSecret(secret);
        // Never forward raw CLI output; it can contain credentials or payloads.
        if (/Ready!|Connected to event stream/i.test(clean)) console.log(`${provider}: listener connection ready.`);
        const event = clean.match(/(?:customer\.subscription\.(?:created|updated|deleted)|invoice\.(?:paid|payment_failed)|checkout\.session\.completed|video\.asset\.[a-z_]+)/)?.[0];
        const status = clean.match(/\[([245]\d\d)\]/)?.[1];
        if (event || status) console.log(`${provider}: ${event || 'delivery'}${status ? ' HTTP ' + status : ''}`);
        if (/error|failed|unauthorized|forbidden/i.test(clean)) {
          const statusCode = clean.match(/\b(?:401|403|404|429|500|502|503)\b/)?.[0];
          console.log(`${provider}: CLI reported an error${statusCode ? ' HTTP ' + statusCode : ''} (raw output suppressed).`);
        }
      } catch (error) { console.error(error.message); child.kill(); process.exitCode = 1; }
    }
  });
}
consume(child.stdout); consume(child.stderr);
child.on('error', () => { console.error(`${provider}: could not start CLI.`); process.exitCode = 1; });
child.on('exit', code => { console.log(`${provider}: listener stopped (${code}).`); process.exitCode = code || 0; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill());
