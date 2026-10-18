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
