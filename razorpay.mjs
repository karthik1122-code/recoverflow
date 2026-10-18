/**
 * Minimal Razorpay REST client. Live keys only work when the operator opts in with
 * RAZORPAY_MODE=live, so a demo deployment can never move real money by accident.
 */
export class RazorpayError extends Error {
  constructor(code, message, details) { super(message || code); this.code = code; this.details = details; }
}

export function razorpayConfig(env = process.env) {
  const keyId = env.RAZORPAY_KEY_ID || '';
  const keySecret = env.RAZORPAY_KEY_SECRET || '';
  const live = env.RAZORPAY_MODE === 'live';
  if (!keyId || !keySecret) return { ready: false, reason: 'razorpay_not_configured' };
  if (!keyId.startsWith('rzp_test_') && !(live && keyId.startsWith('rzp_live_'))) return { ready: false, reason: 'live_keys_need_RAZORPAY_MODE_live' };
  return { ready: true, keyId, keySecret, mode: keyId.startsWith('rzp_live_') ? 'live' : 'test', base: (env.RAZORPAY_API_BASE || 'https://api.razorpay.com').replace(/\/$/, '') };
}

export async function createPaymentLink(config, body, { fetchImpl = fetch, timeoutMs = 10_000 } = {}) {
  if (!config?.ready) throw new RazorpayError(config?.reason || 'razorpay_not_configured');
  const auth = Buffer.from(`${config.keyId}:${config.keySecret}`).toString('base64');
  let response;
  try {
    response = await fetchImpl(`${config.base}/v1/payment_links`, {
      method: 'POST',
      headers: { authorization: `Basic ${auth}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new RazorpayError('razorpay_unreachable', 'Razorpay did not respond', { cause: String(error?.message || error) });
  }
  let data = null;
  try { data = await response.json(); } catch { /* non-JSON error page */ }
  if (!response.ok || !data?.id || !data?.short_url) {
    throw new RazorpayError('razorpay_rejected', data?.error?.description || `Razorpay returned ${response.status}`, { status: response.status, error: data?.error });
  }
  return { id: data.id, short_url: data.short_url, status: data.status, expire_by: data.expire_by ?? null };
}

/** Look up the link we may have created for a case, by its reference id. Returns null when none exists. */
export async function findPaymentLinkByReference(config, referenceId, { fetchImpl = fetch, timeoutMs = 10_000 } = {}) {
  if (!config?.ready) throw new RazorpayError(config?.reason || 'razorpay_not_configured');
  const auth = Buffer.from(`${config.keyId}:${config.keySecret}`).toString('base64');
  let response;
  try {
    response = await fetchImpl(`${config.base}/v1/payment_links?reference_id=${encodeURIComponent(referenceId)}`, { headers: { authorization: `Basic ${auth}` }, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    throw new RazorpayError('razorpay_unreachable', 'Razorpay did not respond', { cause: String(error?.message || error) });
  }
  let data = null;
  try { data = await response.json(); } catch { /* ignore */ }
  if (!response.ok) throw new RazorpayError('razorpay_rejected', data?.error?.description || `Razorpay returned ${response.status}`, { status: response.status });
  const link = (data?.payment_links || []).find(l => l.reference_id === referenceId && l.status !== 'cancelled');
  return link ? { id: link.id, short_url: link.short_url, status: link.status, expire_by: link.expire_by ?? null } : null;
}

/**
 * Stand-in provider for the public demo (DEMO=on and no Razorpay keys). Links are clearly
 * fake (rzp.io/demo/...) and nothing leaves the server.
 */
export function simulatedProvider() {
  let n = 0;
  return {
    ready: true, mode: 'simulated',
    async createPaymentLink(body) { n += 1; return { id: `plink_demo_${Date.now().toString(36)}${n}`, short_url: `https://rzp.io/demo/${body.reference_id}`, status: 'created', expire_by: body.expire_by ?? null }; },
    async findPaymentLinkByReference() { return null; },
  };
}

/** Real provider bound to config, with the same shape as the simulated one. */
export function razorpayProvider(config, opts) {
  return {
    ready: config.ready, mode: config.mode || null, reason: config.reason,
    createPaymentLink: body => createPaymentLink(config, body, opts),
    findPaymentLinkByReference: ref => findPaymentLinkByReference(config, ref, opts),
  };
}
