import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { diagnose, policyDecision } from './core.mjs';
import { evaluateRazorpayWebhook, verifyRazorpaySignature } from './webhook.mjs';
import { appendAudit, verifyAuditChain } from './audit.mjs';
import { claimEvent, razorpayEventKey } from './idempotency.mjs';
import { draftRecoveryMessage } from './messages.mjs';

const port = Number(process.env.PORT || 4173);
const root = new URL('.', import.meta.url).pathname;
const events = [];
const audit = [];
const processedWebhookEvents = new Set();
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8'};

const readBody = request => new Promise((resolve, reject) => { const chunks=[]; request.on('data', c => chunks.push(c)); request.on('end',()=>resolve(Buffer.concat(chunks))); request.on('error',reject); });
const reply = (response, status, body) => { response.writeHead(status, {'content-type':'application/json; charset=utf-8'}); response.end(JSON.stringify(body)); };
const auditEvent = (title, detail, paymentId) => appendAudit(audit, {title, detail, payment_id:paymentId});

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  try {
    if (request.method === 'POST' && url.pathname === '/webhooks/razorpay') {
      const raw = await readBody(request);
      if (!verifyRazorpaySignature(raw, request.headers['x-razorpay-signature'], process.env.RAZORPAY_WEBHOOK_SECRET)) return reply(response, 401, {error:'invalid webhook signature'});
      const payload = JSON.parse(raw.toString('utf8'));
      const idempotencyKey = razorpayEventKey(payload);
      if (!claimEvent(processedWebhookEvents, idempotencyKey)) return reply(response, 200, {duplicate:true, idempotency_key:idempotencyKey});
      const evaluation = evaluateRazorpayWebhook(payload);
      if (evaluation.ignored) return reply(response, 202, evaluation);
      const record = {...evaluation.event, idempotency_key:idempotencyKey, diagnosis:evaluation.diagnosis, decision:evaluation.decision, received_at:new Date().toISOString()};
      events.unshift(record);
      auditEvent(`Webhook received: ${payload.event}`, `${evaluation.diagnosis.label} (${Math.round(evaluation.diagnosis.confidence*100)}% confidence); ${evaluation.decision.status}.`, record.id);
      return reply(response, 201, {id:record.id, diagnosis:evaluation.diagnosis, decision:evaluation.decision});
    }
    if (request.method === 'POST' && url.pathname === '/api/diagnose') {
      const event = JSON.parse((await readBody(request)).toString('utf8'));
      const diagnosis = diagnose(event); const decision = policyDecision(event, diagnosis);
      auditEvent('Manual batch event evaluated', `${diagnosis.label}; ${decision.policy_code}.`, event.id || 'manual');
      return reply(response, 200, {diagnosis, decision});
    }
    if (request.method === 'POST' && url.pathname === '/api/draft-message') {
      const {event, language} = JSON.parse((await readBody(request)).toString('utf8'));
      const draft = draftRecoveryMessage(event, language);
      auditEvent(draft.allowed ? 'Recovery message drafted' : 'Recovery message blocked', draft.allowed ? `Drafted ${draft.language} communication; approval remains required before sending.` : draft.reason, event.id || 'manual');
      return reply(response, draft.allowed ? 200 : 422, draft);
    }
    if (request.method === 'GET' && url.pathname === '/api/audit') return reply(response, 200, {events, audit, integrity:verifyAuditChain(audit)});
    if (request.method === 'POST' && url.pathname === '/api/create-test-payment-link') {
      if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) return reply(response, 400, {error:'Add Razorpay TEST mode credentials to your environment first.'});
      const body = JSON.parse((await readBody(request)).toString('utf8'));
      const auth = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64');
      const upstream = await fetch('https://api.razorpay.com/v1/payment_links/', {method:'POST', headers:{authorization:`Basic ${auth}`,'content-type':'application/json'}, body:JSON.stringify({amount:body.amount || 10000,currency:'INR',reference_id:`recoverflow_${Date.now()}`,description:'RecoverFlow test-mode recovery link',notes:{recovery_opt_in:'true',source:'recoverflow_demo'}})});
      const data = await upstream.json();
      if (!upstream.ok) return reply(response, upstream.status, {error:'Razorpay rejected test link request', details:data});
      auditEvent('Test-mode payment link created', `Created link ${data.id}; no real money is involved.`, data.id);
      return reply(response, 201, {id:data.id, short_url:data.short_url, status:data.status});
    }
    if (request.method === 'GET') {
      const requested = url.pathname === '/' ? '/index.html' : url.pathname;
      const path = normalize(join(root, requested));
      if (!path.startsWith(root)) return response.end('Not found');
      const file = await readFile(path); response.writeHead(200, {'content-type':mime[extname(path)] || 'application/octet-stream'}); return response.end(file);
    }
    reply(response, 404, {error:'not found'});
  } catch (error) { reply(response, 500, {error:'internal_error', message:error.message}); }
});
server.listen(port, () => console.log(`RecoverFlow ready at http://localhost:${port}`));
