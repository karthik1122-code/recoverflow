// In-browser stand-in for server.mjs, built from the same pure modules (events, cases, report, demo).
// Every case moves through the real state machine; only the Razorpay calls are simulated.
import { evaluateRazorpayWebhook } from './lib/events.mjs';
import { CaseError, initialRecovery, paymentLinkRequest, statusOf, summarize, transition } from './lib/cases.mjs';
import { buildReport } from './lib/report.mjs';
import { paidPayload, seedDemo, testFailurePayload } from './lib/demo.mjs';
import { sha256 } from './sha256.mjs';

const KEY = 'rf-preview-v1';
const MERCHANT = 'Kesari Naturals';
const LINK_EVENTS = ['payment_link.paid', 'payment_link.expired', 'payment_link.cancelled'];
const FAILURE_EVENTS = ['payment.failed', 'subscription.pending', 'subscription.halted'];
const DEMO_USER = { id: 'demo', email: 'demo@local', name: 'Demo', role: 'admin' };

/* audit chain, identical canonical form and hashing to audit.mjs */
const canonical = r => JSON.stringify({ id: r.id, title: r.title, detail: r.detail, payment_id: r.payment_id, at: r.at, previous_hash: r.previous_hash });
function appendAudit(chain, { title, detail, payment_id }) {
  const record = { id: `audit_${Date.now()}_${chain.length}`, title, detail, payment_id, at: new Date().toISOString(), previous_hash: chain[0]?.integrity_hash || 'GENESIS' };
  record.integrity_hash = sha256(canonical(record));
  chain.unshift(record);
}
function verifyAuditChain(chain) {
  for (let i = 0; i < chain.length; i += 1) {
    const r = chain[i];
    if (r.integrity_hash !== sha256(canonical(r))) return { valid: false, index: i, reason: 'record_hash_mismatch' };
    if ((chain[i + 1]?.integrity_hash || 'GENESIS') !== r.previous_hash) return { valid: false, index: i, reason: 'chain_link_mismatch' };
  }
  return { valid: true, records: chain.length, head_hash: chain[0]?.integrity_hash || 'GENESIS' };
}

let db = { events: [], audit: [], claimed: [] };
const save = () => { try { sessionStorage.setItem(KEY, JSON.stringify(db)); } catch { /* storage blocked: state lives for this page only */ } };
const load = () => { try { const raw = sessionStorage.getItem(KEY); if (raw) { db = JSON.parse(raw); return true; } } catch { /* ignore */ } return false; };

let linkN = 0;
const createPaymentLink = async body => { linkN += 1; return { id: `plink_demo_${Date.now().toString(36)}${linkN}`, short_url: `https://rzp.io/demo/${body.reference_id}`, status: 'created', expire_by: body.expire_by ?? null }; };
async function updateEvent(id, mutate, audit$ = () => null) {
  const i = db.events.findIndex(e => e.id === id);
  if (i === -1) return null;
  const next = await mutate(db.events[i]);
  db.events[i] = next;
  const entry = audit$(next);
  if (entry) appendAudit(db.audit, entry);
  return next;
}
async function ingestFailure(payload, raw, { receivedAt = new Date().toISOString() } = {}) {
  const p = payload?.payload?.payment?.entity || {};
  const key = `${payload.event}:${p.id}:${p.created_at}`;
  if (db.claimed.includes(key)) return { status: 200, body: { duplicate: true, idempotency_key: key } };
  db.claimed.push(key);
  const evaluation = evaluateRazorpayWebhook(payload);
  if (evaluation.ignored) return { status: 202, body: evaluation };
  const record = { ...evaluation.event, idempotency_key: key, diagnosis: evaluation.diagnosis, decision: evaluation.decision, recovery: initialRecovery(evaluation.decision), received_at: receivedAt };
  db.events.unshift(record);
  appendAudit(db.audit, { title: `Webhook received: ${payload.event}`, detail: `${evaluation.diagnosis.label} (${Math.round(evaluation.diagnosis.confidence * 100)}% confidence); ${evaluation.decision.status}.`, payment_id: record.id });
  return { status: 201, body: { id: record.id, diagnosis: evaluation.diagnosis, decision: evaluation.decision } };
}

const rupee = paise => `₹${((Number(paise) || 0) / 100).toLocaleString('en-IN')}`;
const maskEmail = e => e ? e.replace(/^(.).*(@.*)$/, '$1•••$2') : null;
const maskPhone = p => p ? `•••${String(p).slice(-4)}` : null;
const publicCase = r => ({ ...r, customer: { name: r.customer?.name || null, email: maskEmail(r.customer?.email), contact: maskPhone(r.customer?.contact) }, recovery: { ...(r.recovery || initialRecovery(r.decision)), status: statusOf(r) } });
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const conflict = e => json(e.code === 'policy_blocked' ? 422 : 409, { error: e.code, message: e.message, status: e.current });
const bodyOf = init => { try { return JSON.parse(init.body || '{}'); } catch { return {}; } };

async function handle(url, init) {
  const method = (init.method || 'GET').toUpperCase();
  const path = url.pathname.slice(url.pathname.indexOf('/api/'));
  const by = DEMO_USER.email;
  try {
    if (path === '/api/auth/me') return json(200, { authEnabled: false, needsSetup: false, user: DEMO_USER });
    if (method === 'GET' && path === '/api/cases') {
      const status = url.searchParams.get('status');
      return json(200, { cases: db.events.filter(e => !status || statusOf(e) === status).map(publicCase), summary: summarize(db.events), razorpay: { ready: true, mode: 'simulated' } });
    }
    const caseRoute = method === 'POST' && /^\/api\/cases\/([\w.-]{1,64})\/(approve|dismiss)$/.exec(path);
    if (caseRoute) {
      const [, id, verb] = caseRoute;
      if (verb === 'dismiss') {
        const { reason } = bodyOf(init);
        const updated = await updateEvent(id, r => transition(r, 'dismiss', { by, reason }), r => ({ title: 'Case dismissed', detail: `${by} closed this case without contacting the customer${r.recovery.dismiss_reason ? `: ${r.recovery.dismiss_reason}` : '.'}`, payment_id: id }));
        save();
        return updated ? json(200, { case: publicCase(updated) }) : json(404, { error: 'case_not_found' });
      }
      const claimed = await updateEvent(id, r => transition(r, 'claim', { by }), r => ({ title: 'Recovery approved', detail: `${by} approved one payment link for ${rupee(r.amount)}.`, payment_id: id }));
      if (!claimed) return json(404, { error: 'case_not_found' });
      const link = await createPaymentLink(paymentLinkRequest(claimed));
      const updated = await updateEvent(id, r => transition(r, 'link_sent', link), () => ({ title: 'Payment link sent', detail: `Link ${link.id} created in simulated mode; nothing was sent to anyone.`, payment_id: id }));
      save();
      return json(200, { case: publicCase(updated), link });
    }
    if (method === 'POST' && path.startsWith('/api/demo/pay/')) {
      const id = decodeURIComponent(path.split('/').pop());
      const record = db.events.find(e => e.id === id);
      if (!record) return json(404, { error: 'case_not_found' });
      if (!record.recovery?.link) return json(409, { error: 'no_link', message: 'Send the payment link first.' });
      const payload = paidPayload(record);
      const link = payload.payload.payment_link.entity;
      const updated = await updateEvent(id, r => transition(r, 'paid', { amount_paid: link.amount_paid, payment_id: payload.payload.payment.entity.id }), r => ({ title: 'Payment recovered', detail: `${rupee(r.recovery.recovered_amount)} paid through link ${link.id}.`, payment_id: r.id }));
      save();
      return json(200, { id: updated.id, status: updated.recovery.status });
    }
    if (method === 'GET' && path === '/api/connect') {
      return json(200, { webhook_url: 'https://your-recoverflow-address/webhooks/razorpay', secret_set: true, razorpay: { ready: true, mode: 'simulated', reason: null }, demo: true, merchant_name: MERCHANT, events: [...FAILURE_EVENTS, ...LINK_EVENTS], last_event_at: db.events.reduce((m, e) => (e.received_at > m ? e.received_at : m), '') || null });
    }
    if (method === 'POST' && path === '/api/connect/test-event') {
      const payload = testFailurePayload();
      const result = await ingestFailure(payload, JSON.stringify(payload));
      save();
      return json(result.status, result.body);
    }
    if (method === 'GET' && path === '/api/report') return json(200, buildReport(db.events, { days: url.searchParams.get('days') || 7 }));
    if (method === 'GET' && path === '/api/audit') return json(200, { events: db.events, audit: db.audit, integrity: verifyAuditChain(db.audit) });
    if (method === 'POST' && path === '/api/pilot-request') return json(503, { error: 'preview', message: 'This is a preview, so the form is switched off. Reply to the message that brought you here and I will set up your pilot.' });
    return json(404, { error: 'not found' });
  } catch (e) {
    if (e instanceof CaseError) return conflict(e);
    console.error(e);
    return json(500, { error: 'internal_error' });
  }
}

if (!load()) { await seedDemo({ ingestFailure, updateEvent, createPaymentLink }); save(); }
window.__rfBackendReady({ handle });
