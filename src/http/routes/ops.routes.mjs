import { verifyAuditChain } from '../../domain/audit.mjs';
import { reply, readJson } from '../respond.mjs';

// Health: 200 only when the database answers, so the host can restart a broken instance.
async function checkHealth(store, storeKind) {
  if (!store._pool) return { status: 'ok', store: storeKind };
  try {
    await Promise.race([store._pool.query('SELECT 1'), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000).unref())]);
    return { status: 'ok', store: storeKind };
  } catch { return { status: 'degraded', store: storeKind, db: 'unreachable' }; }
}

// GET /health is public; it runs before the sign-in check.
export async function healthRoutes({ request, response, url }, { store, storeKind }) {
  if (request.method !== 'GET' || url.pathname !== '/health') return false;
  const h = await checkHealth(store, storeKind);
  return reply(response, h.status === 'ok' ? 200 : 503, h);
}

// Signed-in operations: metrics, the audit log with its integrity check, and Razorpay test-mode links.
export async function opsRoutes({ request, response, url, need }, { store, metrics, storeKind, config }) {
  const { method } = request; const path = url.pathname;

  if (method === 'GET' && path === '/api/metrics') {
    if (need('viewer')) return true;
    const { events } = await store.snapshot();
    const by_diagnosis = {}; const by_decision = {};
    for (const e of events) {
      const d = e.diagnosis?.label || 'unknown'; by_diagnosis[d] = (by_diagnosis[d] || 0) + 1;
      const p = e.decision?.policy_code || 'unknown'; by_decision[p] = (by_decision[p] || 0) + 1;
    }
    return reply(response, 200, { store: storeKind, ...metrics.snapshot(), recorded_events: events.length, by_diagnosis, by_decision });
  }

  if (method === 'GET' && path === '/api/audit') {
    if (need('viewer')) return true;
    const { events, audit, anchor } = await store.snapshot();
    return reply(response, 200, { events, audit, integrity: verifyAuditChain(audit, anchor) });
  }

  // Razorpay TEST mode only: refuses live keys, and is off unless ENABLE_TEST_LINKS=true.
  if (method === 'POST' && path === '/api/create-test-payment-link') {
    if (need('admin')) return true;
    if (!config.enableTestLinks) return reply(response, 403, { error: 'Test payment links are disabled. Set ENABLE_TEST_LINKS=true on a private deployment.' });
    const { keyId, keySecret } = config.razorpay();
    if (!keyId || !keySecret) return reply(response, 400, { error: 'Add Razorpay TEST mode credentials to your environment first.' });
    const body = await readJson(request);
    if (!String(keyId).startsWith('rzp_test_')) return reply(response, 400, { error: 'Only Razorpay TEST mode keys (rzp_test_...) are accepted.' });
    const amount = Math.min(Math.max(Number(body.amount) || 10000, 100), 500000);
    const basic = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
    const upstream = await fetch('https://api.razorpay.com/v1/payment_links/', {
      method: 'POST',
      headers: { authorization: `Basic ${basic}`, 'content-type': 'application/json' },
      body: JSON.stringify({ amount, currency: 'INR', reference_id: `recoverflow_${Date.now()}`, description: 'RecoverFlow test-mode recovery link', notes: { recovery_opt_in: 'true', source: 'recoverflow_demo' } }),
    });
    const data = await upstream.json();
    if (!upstream.ok) return reply(response, upstream.status, { error: 'Razorpay rejected test link request', details: data });
    await store.addAudit('Test-mode payment link created', `Created link ${data.id}; no real money is involved.`, data.id);
    return reply(response, 201, { id: data.id, short_url: data.short_url, status: data.status });
  }
  return false;
}
