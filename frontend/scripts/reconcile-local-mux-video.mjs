// Recover a missed LOCAL webhook for one explicitly selected asset. No Mux mutations.
import Mux from '@mux/ts';
import { createHmac } from 'node:crypto';
const id = process.argv[2];
if (!id || !/^[A-Za-z0-9_-]{1,255}$/.test(id)) throw new Error('Supply one Mux asset ID.');
if (!process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_') || !process.env.MUX_WEBHOOK_SECRET) {
  throw new Error('Local test configuration and webhook secret required.');
}
try {
  const mux = new Mux({ timeout: 15000, maxRetries: 0 });
  const asset = await mux.video.assets.retrieve(id);
  if (asset.id !== id) throw new Error('Asset mismatch.');
  const body = JSON.stringify({ type: 'video.asset.updated', data: { id } });
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac('sha256', process.env.MUX_WEBHOOK_SECRET).update(`${timestamp}.${body}`).digest('hex');
  const response = await fetch('http://localhost:3000/api/mux/webhook', {
    method: 'POST', body, headers: { 'content-type': 'application/json', 'mux-signature': `t=${timestamp},v1=${signature}` },
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) throw new Error(`Local reconciliation returned HTTP ${response.status}.`);
  console.log('Local reconciliation accepted. The normal handler rechecked current Mux safety settings. No provider asset was modified.');
} catch (error) {
  console.error(error.status ? `Mux returned HTTP ${error.status}.` : error.message);
  process.exitCode = 1;
}
