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

const port = Number(process.env.PORT || 4173);
const publicRoot = new URL('./public/', import.meta.url).pathname;
const MAX_BODY = 100 * 1024;
const MAX_RECORDS = 500;
const ENABLE_TEST_LINKS = process.env.ENABLE_TEST_LINKS === 'true';
const store = process.env.DATABASE_URL
  ? await createPostgresStore({ connectionString: process.env.DATABASE_URL, maxRecords: MAX_RECORDS })
  : createMemoryStore({ maxRecords: MAX_RECORDS });
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
  const chunks = []; let size = 0;
  request.on('data', c => { size += c.length; if (size > MAX_BODY) { reject(new HttpError(413, 'payload_too_large')); request.destroy(); return; } chunks.push(c); });
  request.on('end', () => resolve(Buffer.concat(chunks)));
  request.on('error', reject);
});
const readJson = async request => {
  const raw = await readBody(request);
  try { return JSON.parse(raw.toString('utf8') || '{}'); } catch { throw new HttpError(400, 'invalid_json'); }
};
const reply = (response, status, body) => { response.writeHead(status, {'content-type':'application/json; charset=utf-8','cache-control':'no-store',...securityHeaders}); response.end(JSON.stringify(body)); };
const auditEvent = (title, detail, paymentId) => store.addAudit(title, detail, paymentId);

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  try {
    if (request.method === 'POST' && url.pathname === '/webhooks/razorpay') {
      const raw = await readBody(request);
      if (!verifyRazorpaySignature(raw, request.headers['x-razorpay-signature'], process.env.RAZORPAY_WEBHOOK_SECRET)) return reply(response, 401, {error:'invalid webhook signature'});
      let payload; try { payload = JSON.parse(raw.toString('utf8')); } catch { throw new HttpError(400, 'invalid_json'); }
      const idempotencyKey = razorpayEventKey(payload, raw);
      const outcome = await store.commitWebhook(idempotencyKey, () => {
        const evaluation = evaluateRazorpayWebhook(payload);
        if (evaluation.ignored) return {value:{status:202, body:evaluation}};
        const record = {...evaluation.event, idempotency_key:idempotencyKey, diagnosis:evaluation.diagnosis, decision:evaluation.decision, received_at:new Date().toISOString()};
        return {
          event: record,
          audit: {title:`Webhook received: ${payload.event}`, detail:`${evaluation.diagnosis.label} (${Math.round(evaluation.diagnosis.confidence*100)}% confidence); ${evaluation.decision.status}.`, payment_id:record.id},
          value: {status:201, body:{id:record.id, diagnosis:evaluation.diagnosis, decision:evaluation.decision}},
        };
      });
      if (outcome.duplicate) return reply(response, 200, {duplicate:true, idempotency_key:idempotencyKey});
      return reply(response, outcome.value.status, outcome.value.body);
    }
    if (request.method === 'POST' && url.pathname === '/api/diagnose') {
      const event = await readJson(request);
      if (!event || typeof event !== 'object' || Array.isArray(event)) throw new HttpError(400, 'invalid_event');
      const diagnosis = diagnose(event); const decision = policyDecision(event, diagnosis);
      await auditEvent('Manual batch event evaluated', `${diagnosis.label}; ${decision.policy_code}.`, event.id || 'manual');
      return reply(response, 200, {diagnosis, decision});
    }
    if (request.method === 'POST' && url.pathname === '/api/draft-message') {
      const {event, language} = await readJson(request);
      if (!event || typeof event !== 'object') throw new HttpError(400, 'invalid_event');
      const draft = draftRecoveryMessage(event, language);
      await auditEvent(draft.allowed ? 'Recovery message drafted' : 'Recovery message blocked', draft.allowed ? `Drafted ${draft.language} communication; approval remains required before sending.` : draft.reason, event.id || 'manual');
      return reply(response, draft.allowed ? 200 : 422, draft);
    }
    if (request.method === 'GET' && url.pathname === '/api/audit') { const {events, audit, anchor} = await store.snapshot(); return reply(response, 200, {events, audit, integrity:verifyAuditChain(audit, anchor)}); }
    if (request.method === 'POST' && url.pathname === '/api/create-test-payment-link') {
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
    if (request.method === 'GET' || request.method === 'HEAD') {
      let requested; try { requested = decodeURIComponent(url.pathname); } catch { throw new HttpError(400, 'bad_path'); }
      if (requested === '/') requested = '/index.html';
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
    reply(response, 500, {error:'internal_error'});
  }
});
server.listen(port, () => console.log(`RecoverFlow ready at http://localhost:${port}`));
