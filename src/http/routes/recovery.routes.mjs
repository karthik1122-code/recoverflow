import { diagnose, policyDecision } from '../../domain/diagnosis.mjs';
import { draftRecoveryMessage } from '../../domain/messages.mjs';
import { reply, readJson, readObject, clientIp, HttpError } from '../respond.mjs';

// Public, stateless demo for the landing page: no audit write, no stored data, rate limited per address.
const playHits = new Map();
export async function playRoutes({ request, response, url }) {
  if (request.method !== 'POST' || url.pathname !== '/api/play/diagnose') return false;
  const ip = clientIp(request), now = Date.now();
  const hits = (playHits.get(ip) || []).filter(t => now - t < 60000);
  if (hits.length >= 60) return reply(response, 429, { error: 'rate_limited' });
  hits.push(now); playHits.set(ip, hits);
  if (playHits.size > 5000) playHits.clear();
  const event = await readObject(request);
  const diagnosis = diagnose(event);
  return reply(response, 200, { diagnosis, decision: policyDecision(event, diagnosis) });
}

// Signed-in recovery work: diagnose an event, draft a message, record a human decision. Every step is audited.
export async function recoveryRoutes({ request, response, url, user, need }, { store }) {
  if (request.method !== 'POST') return false;
  const audit = (title, detail, paymentId) => store.addAudit(title, detail, paymentId);

  if (url.pathname === '/api/diagnose') {
    if (need('approver')) return true;
    const event = await readObject(request);
    const diagnosis = diagnose(event); const decision = policyDecision(event, diagnosis);
    await audit('Manual batch event evaluated', `${diagnosis.label}; ${decision.policy_code}.`, event.id || 'manual');
    return reply(response, 200, { diagnosis, decision });
  }

  if (url.pathname === '/api/draft-message') {
    if (need('approver')) return true;
    const { event, language } = await readJson(request);
    if (!event || typeof event !== 'object') throw new HttpError(400, 'invalid_event');
    const draft = draftRecoveryMessage(event, language);
    await audit(draft.allowed ? 'Recovery message drafted' : 'Recovery message blocked', draft.allowed ? `Drafted ${draft.language} communication; approval remains required before sending.` : draft.reason, event.id || 'manual');
    return reply(response, draft.allowed ? 200 : 422, draft);
  }

  // A human decision on one recommended action. It is sealed into the audit chain with who made it.
  if (url.pathname === '/api/decisions') {
    if (need('approver')) return true;
    const body = await readJson(request);
    const paymentId = String(body.payment_id || '');
    const action = typeof body.action === 'string' ? body.action.trim() : '';
    const amount = Number(body.amount);
    if (!/^[\w-]{1,64}$/.test(paymentId)) throw new HttpError(400, 'invalid_payment_id');
    if (body.decision !== 'approved' && body.decision !== 'held') throw new HttpError(400, 'invalid_decision');
    if (!action || action.length > 200) throw new HttpError(400, 'invalid_action');
    if (!Number.isFinite(amount) || amount < 0 || amount > 1e9) throw new HttpError(400, 'invalid_amount');
    const who = user.email || user.name || 'unknown';
    const record = body.decision === 'approved'
      ? await audit(`Human approved ${paymentId}`, `${who} approved "${action}" for ₹${amount.toLocaleString('en-IN')}. One bounded action; automatic retries and further contact stay off.`, paymentId)
      : await audit(`Human kept ${paymentId} on hold`, `${who} declined "${action}". No money action was taken.`, paymentId);
    return reply(response, 201, { record });
  }
  return false;
}
