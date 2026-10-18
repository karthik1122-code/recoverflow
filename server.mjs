import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { diagnose, policyDecision } from './core.mjs';
import { evaluateRazorpayWebhook, verifyRazorpaySignature } from './webhook.mjs';
import { verifyAuditChain } from './audit.mjs';
import { razorpayEventKey } from './idempotency.mjs';
import { createMemoryStore } from './store.mjs';
import { createPostgresStore } from './pg-store.mjs';
import { draftRecoveryMessage } from './messages.mjs';
import { createMetrics } from './metrics.mjs';
import { CaseError, initialRecovery, paymentLinkRequest, statusOf, summarize, transition } from './cases.mjs';
import { razorpayConfig, razorpayProvider, simulatedProvider } from './razorpay.mjs';
import { sweepStaleApprovals } from './sweeper.mjs';
import { buildReport } from './report.mjs';
import { demoScenarios, paidPayload, testFailurePayload } from './demo.mjs';
import { createHmac } from 'node:crypto';
import { createAuth, createMemoryAuthStore, createPostgresAuthStore, AuthError } from './auth.mjs';

const port = Number(process.env.PORT || 4173);
const publicRoot = new URL('./public/', import.meta.url).pathname;
const MAX_BODY = 100 * 1024;
const MAX_RECORDS = 500;
const ENABLE_TEST_LINKS = process.env.ENABLE_TEST_LINKS === 'true';
const store = process.env.DATABASE_URL
  ? await createPostgresStore({ connectionString: process.env.DATABASE_URL, maxRecords: MAX_RECORDS })
  : createMemoryStore({ maxRecords: MAX_RECORDS });
const metrics = createMetrics();
// Accounts are on by default. AUTH=off serves the synthetic demo with no sign-in; the webhook stays signature-protected either way.
const AUTH_ON = process.env.AUTH !== 'off';
const SETUP_TOKEN = process.env.SETUP_TOKEN || '';
const auth = createAuth({ db: store._pool ? await createPostgresAuthStore(store._pool) : createMemoryAuthStore() });
const DEMO_USER = { id: 'demo', email: 'demo@local', name: 'Demo', role: 'admin' };
const cookieOf = request => { const m = /(?:^|;\s*)rf_session=([\w-]+)/.exec(request.headers.cookie || ''); return m ? m[1] : ''; };
const secure = request => process.env.NODE_ENV === 'production' || request.headers['x-forwarded-proto'] === 'https';
const setCookie = (request, token, maxAge) => `rf_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure(request) ? '; Secure' : ''}`;
const authStatus = code => ({ bad_credentials: 401, locked: 429, already_set_up: 409, email_taken: 409, not_found: 404, self_delete: 409, last_admin: 409 }[code] || 400);
const storeKind = process.env.DATABASE_URL ? 'postgres' : 'memory';
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'};
const securityHeaders = {
  'x-content-type-options':'nosniff',
  'x-frame-options':'DENY',
  'referrer-policy':'no-referrer',
  'permissions-policy':'camera=(), microphone=(), geolocation=()',
  'content-security-policy':"default-src 'self'; style-src 'self' https://fonts.googleapis.com 'unsafe-inline'; font-src https://fonts.gstatic.com; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
};
class HttpError extends Error { constructor(status, code) { super(code); this.status = status; this.code = code; } }

const readBody = request => new Promise((resolve, reject) => {
  const chunks = []; let size = 0, over = false;
  // Past the limit, keep draining (so the client can read the 413) but store nothing, and cut the connection after a second.
  request.on('data', c => { size += c.length; if (over) return; if (size > MAX_BODY) { over = true; reject(new HttpError(413, 'payload_too_large')); setTimeout(() => request.destroy(), 1000).unref(); return; } chunks.push(c); });
  request.on('end', () => resolve(Buffer.concat(chunks)));
  request.on('error', reject);
});
const readJson = async request => {
  const raw = await readBody(request);
  try { return JSON.parse(raw.toString('utf8') || '{}'); } catch { throw new HttpError(400, 'invalid_json'); }
};
const reply = (response, status, body, extra = {}) => { response.writeHead(status, {'content-type':'application/json; charset=utf-8','cache-control':'no-store',...securityHeaders,...extra}); response.end(JSON.stringify(body)); };
const DEMO = process.env.DEMO === 'on';
const rzConfig = razorpayConfig();
// Real Razorpay when keys are set. The simulated provider is only ever used by the public demo.
const provider = rzConfig.ready || !DEMO ? razorpayProvider(rzConfig) : simulatedProvider();
const LINK_EVENTS = ['payment_link.paid', 'payment_link.expired', 'payment_link.cancelled'];
const FAILURE_EVENTS = ['payment.failed', 'subscription.pending', 'subscription.halted'];
const playHits = new Map();
const pilotHits = new Map();
const rupee = paise => `₹${((Number(paise) || 0) / 100).toLocaleString('en-IN')}`;
const maskEmail = e => e ? e.replace(/^(.).*(@.*)$/, '$1•••$2') : null;
const maskPhone = p => p ? `•••${String(p).slice(-4)}` : null;
// Viewers see who a case is about without the full contact details.
const publicCase = r => ({ ...r, customer: { name: r.customer?.name || null, email: maskEmail(r.customer?.email), contact: maskPhone(r.customer?.contact) }, recovery: { ...(r.recovery || initialRecovery(r.decision)), status: statusOf(r) } });
const caseConflict = (response, e) => reply(response, e.code === 'policy_blocked' ? 422 : 409, { error: e.code, message: e.message, status: e.current });

async function applyLinkEvent(payload) {
  const link = payload?.payload?.payment_link?.entity || {};
  const paid = payload?.payload?.payment?.entity || {};
  const caseId = link.notes?.rf_case;
  if (!caseId || link.notes?.source !== 'recoverflow') { metrics.record('ignored'); return {status:202, body:{ ignored: true, reason: 'not_a_recoverflow_link' }}; }
  const action = payload.event === 'payment_link.paid' ? 'paid' : 'expired';
  try {
    const updated = await store.updateEvent(caseId, r => {
      if (r.recovery?.link?.id && link.id && r.recovery.link.id !== link.id) throw new CaseError('link_mismatch', 'this payment link does not belong to the case', statusOf(r));
      return transition(r, action, { amount_paid: link.amount_paid ?? paid.amount, payment_id: paid.id });
    }, r => action === 'paid'
      ? { title: 'Payment recovered', detail: `${rupee(r.recovery.recovered_amount)} paid through link ${link.id}.`, payment_id: r.id }
      : { title: 'Recovery link expired', detail: `Link ${link.id} ${payload.event.split('.')[1]} without payment.`, payment_id: r.id });
    if (!updated) { metrics.record('ignored'); return {status:202, body:{ ignored: true, reason: 'unknown_case' }}; }
    metrics.record('accepted');
    return {status:200, body:{ id: updated.id, status: updated.recovery.status }};
  } catch (e) {
    if (!(e instanceof CaseError)) throw e;
    // A redelivered paid/expired event finds the case already in that state: acknowledge, change nothing.
    if ((action === 'paid' && e.current === 'recovered') || (action === 'expired' && ['expired', 'recovered'].includes(e.current))) { metrics.record('duplicates_blocked'); return {status:200, body:{ duplicate: true, status: e.current }}; }
    return {status: e.code === 'policy_blocked' ? 422 : 409, body:{ error: e.code, message: e.message, status: e.current }};
  }
}

/** One path for every failure event: real webhooks, the Connect test button and the demo seed. */
async function ingestFailure(payload, raw, { receivedAt = new Date().toISOString() } = {}) {
  const idempotencyKey = razorpayEventKey(payload, raw);
  const outcome = await store.commitWebhook(idempotencyKey, () => {
    const evaluation = evaluateRazorpayWebhook(payload);
    if (evaluation.ignored) return {value:{status:202, body:evaluation}};
    const record = {...evaluation.event, idempotency_key:idempotencyKey, diagnosis:evaluation.diagnosis, decision:evaluation.decision, recovery:initialRecovery(evaluation.decision), received_at:receivedAt};
    return {
      event: record,
      audit: {title:`Webhook received: ${payload.event}`, detail:`${evaluation.diagnosis.label} (${Math.round(evaluation.diagnosis.confidence*100)}% confidence); ${evaluation.decision.status}.`, payment_id:record.id},
      value: {status:201, body:{id:record.id, diagnosis:evaluation.diagnosis, decision:evaluation.decision}},
    };
  });
  if (outcome.duplicate) { metrics.record('duplicates_blocked'); return {status:200, body:{duplicate:true, idempotency_key:idempotencyKey}}; }
  metrics.record(outcome.value.status === 201 ? 'accepted' : 'ignored');
  return outcome.value;
}

async function approveCase(id, by) {
  if (!provider.ready) return {status:409, body:{error:provider.reason || 'razorpay_not_configured', message:'Add your Razorpay API keys on the Connect page before approving.'}};
  let claimed;
  try {
    claimed = await store.updateEvent(id, r => transition(r, 'claim', {by}), r => ({title:'Recovery approved', detail:`${by} approved one payment link for ${rupee(r.amount)}.`, payment_id:id}));
  } catch (e) { if (e instanceof CaseError) return {status: e.code === 'policy_blocked' ? 422 : 409, body:{error:e.code, message:e.message, status:e.current}}; throw e; }
  if (!claimed) return {status:404, body:{error:'case_not_found'}};
  let link;
  try {
    link = await provider.createPaymentLink(paymentLinkRequest(claimed));
  } catch (e) {
    await store.updateEvent(id, r => statusOf(r) === 'approving' ? transition(r, 'release', {error:e.message}) : r, () => ({title:'Payment link failed', detail:`${e.message}. The case is open again; nothing was sent.`, payment_id:id}));
    return {status:502, body:{error:e.code || 'razorpay_failed', message:e.message}};
  }
  const updated = await store.updateEvent(id,
    r => statusOf(r) === 'approving' ? transition(r, 'link_sent', link) : {...r, recovery:{...r.recovery, link}},
    r => ({title:'Payment link sent', detail:`Link ${link.id} created in ${provider.mode} mode${provider.mode === 'simulated' ? '; nothing was sent to anyone' : r.customer?.contact || r.customer?.email ? '; Razorpay notified the customer' : '; no customer contact on file, share the link manually'}.`, payment_id:id}));
  return {status:200, body:{case:publicCase(updated), link}};
}

async function seedDemo() {
  for (const { outcome, hoursAgo, payload } of demoScenarios()) {
    const receivedAt = new Date(Date.now() - hoursAgo * 3_600_000).toISOString();
    const at = minutes => new Date(Date.parse(receivedAt) + minutes * 60_000).toISOString();
    await ingestFailure(payload, JSON.stringify(payload), { receivedAt });
    const id = payload.payload.payment.entity.id;
    if (outcome === 'open' || outcome === 'held') continue;
    const link = await provider.createPaymentLink({ reference_id: `rf_${id}` });
    await store.updateEvent(id, r => {
      let next = transition(r, 'claim', { by: 'demo@recoverflow' }, at(22));
      next = transition(next, 'link_sent', link, at(23));
      if (outcome === 'recovered') next = transition(next, 'paid', { amount_paid: r.amount }, at(160));
      if (outcome === 'expired') next = transition(next, 'expired', {}, at(72 * 60));
      return next;
    }, r => ({ title: outcome === 'recovered' ? 'Payment recovered' : outcome === 'expired' ? 'Recovery link expired' : 'Payment link sent', detail: 'Seeded demo history.', payment_id: r.id }));
  }
}const auditEvent =(title, detail, paymentId) => store.addAudit(title, detail, paymentId);

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  try {
    const mutating = request.method !== 'GET' && request.method !== 'HEAD';
    if (url.pathname.startsWith('/api/') && mutating && !request.headers['x-ag-csrf']) return reply(response, 403, {error:'csrf_header_required'});
    const token = cookieOf(request);
    const user = AUTH_ON ? await auth.userFromToken(token) : DEMO_USER;
    if (request.method === 'GET' && url.pathname === '/api/auth/me') return reply(response, 200, {authEnabled:AUTH_ON, needsSetup:AUTH_ON && await auth.needsSetup(), setupTokenRequired:!!SETUP_TOKEN, user});
    if (AUTH_ON && request.method === 'POST' && url.pathname === '/api/auth/setup') {
      const body = await readJson(request);
      if (SETUP_TOKEN && body.setupToken !== SETUP_TOKEN) return reply(response, 403, {error:'invalid_setup_token', message:'the setup token is wrong'});
      try { await auth.setup(body); const s = await auth.login(body.email, body.password, request.socket.remoteAddress); return reply(response, 201, {user:s.user}, {'set-cookie':setCookie(request, s.token, s.maxAge)}); }
      catch (e) { if (e instanceof AuthError) return reply(response, authStatus(e.code), {error:e.code, message:e.message}); throw e; }
    }
    if (AUTH_ON && request.method === 'POST' && url.pathname === '/api/auth/login') {
      const body = await readJson(request);
      try { const s = await auth.login(body.email, body.password, request.socket.remoteAddress); return reply(response, 200, {user:s.user}, {'set-cookie':setCookie(request, s.token, s.maxAge)}); }
      catch (e) { if (e instanceof AuthError) return reply(response, authStatus(e.code), {error:e.code, message:e.message}); throw e; }
    }
    if (AUTH_ON && request.method === 'POST' && url.pathname === '/api/auth/logout') { await auth.logout(token); return reply(response, 200, {ok:true}, {'set-cookie':setCookie(request, '', 0)}); }
    // Public, stateless demo for the landing page: no audit write, no stored data, rate limited per address.
    if (request.method === 'POST' && url.pathname === '/api/play/diagnose') {
      const ip = request.socket.remoteAddress || '?', now = Date.now();
      const hits = (playHits.get(ip) || []).filter(t => now - t < 60000);
      if (hits.length >= 60) return reply(response, 429, {error:'rate_limited'});
      hits.push(now); playHits.set(ip, hits);
      if (playHits.size > 5000) playHits.clear();
      const event = await readJson(request);
      if (!event || typeof event !== 'object' || Array.isArray(event)) throw new HttpError(400, 'invalid_event');
      const diagnosis = diagnose(event);
      return reply(response, 200, {diagnosis, decision:policyDecision(event, diagnosis)});
    }
    // Public pilot sign-up from the landing page. Stored in the audit chain so it survives restarts on Postgres.
    if (request.method === 'POST' && url.pathname === '/api/pilot-request') {
      const ip = request.socket.remoteAddress || '?', now = Date.now();
      const hits = (pilotHits.get(ip) || []).filter(t => now - t < 3_600_000);
      if (hits.length >= 5) return reply(response, 429, {error:'rate_limited', message:'Too many requests from this address. Try again in an hour.'});
      const body = await readJson(request);
      const clean = (v, n) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
      const lead = {name:clean(body.name, 80), store:clean(body.store, 160), contact:clean(body.contact, 120), volume:clean(body.volume, 40)};
      if (body.website) return reply(response, 201, {ok:true}); // honeypot field: bots fill it, people never see it
      if (!lead.name || !lead.contact || !lead.store) return reply(response, 400, {error:'missing_fields', message:'Add your name, your store and an email or WhatsApp number.'});
      hits.push(now); pilotHits.set(ip, hits); if (pilotHits.size > 5000) pilotHits.clear();
      await auditEvent('Pilot request', `${lead.name} (${lead.store}), contact ${lead.contact}${lead.volume ? `, about ${lead.volume} failed payments a month` : ''}.`, 'pilot');
      return reply(response, 201, {ok:true});
    }
    if (url.pathname.startsWith('/api/') && !user) return reply(response, 401, {error:'sign_in_required'});
    const need = role => { if (auth.can(user, role)) return false; reply(response, 403, {error:'forbidden', message:`this needs the ${role} role`}); return true; };
    if (url.pathname === '/api/users' || /^\/api\/users\/[\w-]+$/.test(url.pathname)) {
      if (need('admin')) return;
      try {
        if (request.method === 'GET' && url.pathname === '/api/users') return reply(response, 200, await auth.listUsers());
        if (request.method === 'POST' && url.pathname === '/api/users') return reply(response, 201, await auth.createUser(await readJson(request)));
        if (request.method === 'DELETE') { await auth.deleteUser(url.pathname.split('/').pop(), user.id); return reply(response, 200, {ok:true}); }
      } catch (e) { if (e instanceof AuthError) return reply(response, authStatus(e.code), {error:e.code, message:e.message}); throw e; }
    }
    if (request.method === 'POST' && url.pathname === '/webhooks/razorpay') {
      const raw = await readBody(request);
      if (!verifyRazorpaySignature(raw, request.headers['x-razorpay-signature'], process.env.RAZORPAY_WEBHOOK_SECRET)) { metrics.record('signature_failures'); return reply(response, 401, {error:'invalid webhook signature'}); }
      let payload; try { payload = JSON.parse(raw.toString('utf8')); } catch { throw new HttpError(400, 'invalid_json'); }
      metrics.record('received');
      const result = LINK_EVENTS.includes(payload?.event) ? await applyLinkEvent(payload) : await ingestFailure(payload, raw);
      return reply(response, result.status, result.body);
    }
    if (request.method === 'POST' && url.pathname === '/api/diagnose') {
      if (need('approver')) return;
      const event = await readJson(request);
      if (!event || typeof event !== 'object' || Array.isArray(event)) throw new HttpError(400, 'invalid_event');
      const diagnosis = diagnose(event); const decision = policyDecision(event, diagnosis);
      await auditEvent('Manual batch event evaluated', `${diagnosis.label}; ${decision.policy_code}.`, event.id || 'manual');
      return reply(response, 200, {diagnosis, decision});
    }
    if (request.method === 'POST' && url.pathname === '/api/draft-message') {
      if (need('approver')) return;
      const {event, language} = await readJson(request);
      if (!event || typeof event !== 'object') throw new HttpError(400, 'invalid_event');
      const draft = draftRecoveryMessage(event, language);
      await auditEvent(draft.allowed ? 'Recovery message drafted' : 'Recovery message blocked', draft.allowed ? `Drafted ${draft.language} communication; approval remains required before sending.` : draft.reason, event.id || 'manual');
      return reply(response, draft.allowed ? 200 : 422, draft);
    }
    if (request.method === 'GET' && url.pathname === '/api/cases') {
      if (need('viewer')) return;
      const {events} = await store.snapshot();
      const status = url.searchParams.get('status');
      const cases = events.filter(e => !status || statusOf(e) === status).map(publicCase);
      return reply(response, 200, {cases, summary:summarize(events), razorpay:{ready:provider.ready, mode:provider.mode || null}});
    }
    const caseRoute = request.method === 'POST' && /^\/api\/cases\/([\w.-]{1,64})\/(approve|dismiss)$/.exec(url.pathname);
    if (caseRoute) {
      if (need('approver')) return;
      const [, id, verb] = caseRoute;
      const by = user.email;
      if (verb === 'dismiss') {
        const {reason} = await readJson(request);
        try {
          const updated = await store.updateEvent(id, r => transition(r, 'dismiss', {by, reason}), r => ({title:'Case dismissed', detail:`${by} closed this case without contacting the customer${r.recovery.dismiss_reason ? `: ${r.recovery.dismiss_reason}` : '.'}`, payment_id:id}));
          return updated ? reply(response, 200, {case:publicCase(updated)}) : reply(response, 404, {error:'case_not_found'});
        } catch (e) { if (e instanceof CaseError) return caseConflict(response, e); throw e; }
      }
      const result = await approveCase(id, by);
      return reply(response, result.status, result.body);
    }
    if (request.method === 'GET' && url.pathname === '/api/connect') {
      if (need('viewer')) return;
      const {events} = await store.snapshot();
      const proto = secure(request) ? 'https' : 'http';
      return reply(response, 200, {
        webhook_url:`${proto}://${request.headers.host}/webhooks/razorpay`,
        secret_set:!!process.env.RAZORPAY_WEBHOOK_SECRET || DEMO,
        razorpay:{ready:provider.ready, mode:provider.mode, reason:provider.reason || null},
        demo:DEMO,
        merchant_name:process.env.MERCHANT_NAME || (DEMO ? 'Kesari Naturals' : 'your store'),
        events:[...FAILURE_EVENTS, ...LINK_EVENTS],
        last_event_at:events.reduce((latest, e) => (e.received_at > latest ? e.received_at : latest), '') || null,
      });
    }
    if (request.method === 'POST' && url.pathname === '/api/connect/test-event') {
      if (need('admin')) return;
      const secret = process.env.RAZORPAY_WEBHOOK_SECRET || (DEMO ? 'demo-only-secret' : '');
      if (!secret) return reply(response, 409, {error:'webhook_secret_missing', message:'Set RAZORPAY_WEBHOOK_SECRET first. It must match the secret in your Razorpay webhook settings.'});
      // Sign exactly like Razorpay does and run the real verification, so a passing test proves the secret works end to end.
      const payload = testFailurePayload();
      const raw = Buffer.from(JSON.stringify(payload));
      const signature = createHmac('sha256', secret).update(raw).digest('hex');
      if (!verifyRazorpaySignature(raw, signature, secret)) return reply(response, 500, {error:'signature_self_check_failed'});
      metrics.record('received');
      const result = await ingestFailure(payload, raw);
      return reply(response, result.status, result.body);
    }
    const demoPay = request.method === 'POST' && /^\/api\/demo\/pay\/([\w.-]{1,64})$/.exec(url.pathname);
    if (demoPay) {
      if (need('approver')) return;
      if (provider.mode !== 'simulated') return reply(response, 404, {error:'not found'});
      const record = await store.getEvent(demoPay[1]);
      if (!record) return reply(response, 404, {error:'case_not_found'});
      if (!record.recovery?.link) return reply(response, 409, {error:'no_link', message:'Send the payment link first.'});
      const result = await applyLinkEvent(paidPayload(record));
      return reply(response, result.status, result.body);
    }
    if (request.method === 'GET' && url.pathname === '/api/report') {
      if (need('viewer')) return;
      const {events} = await store.snapshot();
      return reply(response, 200, buildReport(events, {days:url.searchParams.get('days') || 7}));
    }
    if (request.method === 'GET' && url.pathname === '/api/metrics') {
      if (need('viewer')) return;
      const {events} = await store.snapshot();
      const by_diagnosis = {}; const by_decision = {};
      for (const e of events) { const d = e.diagnosis?.label || 'unknown'; by_diagnosis[d] = (by_diagnosis[d] || 0) + 1; const p = e.decision?.policy_code || 'unknown'; by_decision[p] = (by_decision[p] || 0) + 1; }
      return reply(response, 200, {store: storeKind, ...metrics.snapshot(), recorded_events: events.length, by_diagnosis, by_decision, recovery: summarize(events)});
    }
    if (request.method === 'GET' && url.pathname === '/api/audit') { if (need('viewer')) return; const {events, audit, anchor} = await store.snapshot(); return reply(response, 200, {events, audit, integrity:verifyAuditChain(audit, anchor)}); }
    if (request.method === 'POST' && url.pathname === '/api/create-test-payment-link') {
      if (need('admin')) return;
      if (!ENABLE_TEST_LINKS) return reply(response, 403, {error:'Test payment links are disabled. Set ENABLE_TEST_LINKS=true on a private deployment.'});
      if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) return reply(response, 400, {error:'Add Razorpay TEST mode credentials to your environment first.'});
      const body = await readJson(request);
      if (!String(process.env.RAZORPAY_KEY_ID).startsWith('rzp_test_')) return reply(response, 400, {error:'Only Razorpay TEST mode keys (rzp_test_...) are accepted.'});
      const amount = Math.min(Math.max(Number(body.amount) || 10000, 100), 500000);
      const auth = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64');
      const upstream = await fetch('https://api.razorpay.com/v1/payment_links/', {method:'POST', headers:{authorization:`Basic ${auth}`,'content-type':'application/json'}, body:JSON.stringify({amount,currency:'INR',reference_id:`recoverflow_${Date.now()}`,description:'RecoverFlow test-mode recovery link',notes:{recovery_opt_in:'true',source:'recoverflow_demo'}})});
      const data = await upstream.json();
      if (!upstream.ok) return reply(response, upstream.status, {error:'Razorpay rejected test link request', details:data});
      await auditEvent('Test-mode payment link created', `Created link ${data.id}; no real money is involved.`, data.id);
      return reply(response, 201, {id:data.id, short_url:data.short_url, status:data.status});
    }
    if (request.method === 'GET' && url.pathname === '/health') return reply(response, 200, {status:'ok'});
    // The landing page links to /demo. The workspace forwards it to the separate public demo service.
    if (request.method === 'GET' && url.pathname === '/demo') {
      const target = DEMO || !/^https:\/\/[\w.-]+(:\d+)?\/?$/.test(process.env.DEMO_URL || '') ? '/app.html' : `${process.env.DEMO_URL.replace(/\/$/, '')}/app.html`;
      response.writeHead(302, {location:target, ...securityHeaders}); return response.end();
    }
    if (request.method === 'GET' || request.method === 'HEAD') {
      let requested; try { requested = decodeURIComponent(url.pathname); } catch { throw new HttpError(400, 'bad_path'); }
      if (requested === '/') requested = '/index.html';
      if (AUTH_ON && (requested === '/app.html' || requested === '/team.html') && !(await auth.userFromToken(cookieOf(request)))) { response.writeHead(302, {location:'/login.html', ...securityHeaders}); return response.end(); }
      const path = normalize(join(publicRoot, requested));
      const type = mime[extname(path)];
      const inside = path.startsWith(publicRoot.endsWith(sep) ? publicRoot : publicRoot + sep);
      if (!inside || !type) return reply(response, 404, {error:'not found'});
      let file; try { file = await readFile(path); } catch { return reply(response, 404, {error:'not found'}); }
      response.writeHead(200, {'content-type':type,'cache-control':requested === '/index.html' ? 'no-cache' : 'public, max-age=300',...securityHeaders});
      return response.end(request.method === 'HEAD' ? undefined : file);
    }
    reply(response, 404, {error:'not found'});
  } catch (error) {
    if (error instanceof HttpError) return reply(response, error.status, {error:error.code});
    console.error(error);
    if (url.pathname === '/webhooks/razorpay') metrics.record('errors');
    reply(response, 500, {error:'internal_error'});
  }
});
setInterval(() => auth.sweep().catch(() => {}), 600_000).unref();
const STALE_MS = Number(process.env.STALE_APPROVAL_MS || 10 * 60_000);
setInterval(() => sweepStaleApprovals({store, provider, staleMs:STALE_MS}).catch(e => console.error('sweep failed', e.message)), Math.min(60_000, STALE_MS)).unref();
if (DEMO && (await store.snapshot()).events.length === 0) await seedDemo();
server.listen(port, () => console.log(`RecoverFlow ready at http://localhost:${port} (${storeKind}, auth: ${AUTH_ON ? 'accounts' : 'OFF (demo)'})`));
