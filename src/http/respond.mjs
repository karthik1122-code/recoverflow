import { config } from '../config.mjs';

// Low-level HTTP helpers shared by every route: reading bodies, writing JSON, cookies, client address.

export const securityHeaders = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'content-security-policy': "default-src 'self'; style-src 'self' https://fonts.googleapis.com 'unsafe-inline'; font-src https://fonts.gstatic.com; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
};

/** An error with an HTTP status. Thrown anywhere in a route; the handler turns it into { error: code }. */
export class HttpError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}

export const reply = (response, status, body, extra = {}) => {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...securityHeaders, ...extra });
  response.end(JSON.stringify(body));
  return true; // routes return this to say "handled"
};

export const readBody = request => new Promise((resolve, reject) => {
  const chunks = []; let size = 0, over = false;
  // Past the limit, keep draining (so the client can read the 413) but store nothing, and cut the connection after a second.
  request.on('data', c => {
    size += c.length; if (over) return;
    if (size > config.maxBody) { over = true; reject(new HttpError(413, 'payload_too_large')); setTimeout(() => request.destroy(), 1000).unref(); return; }
    chunks.push(c);
  });
  request.on('end', () => resolve(Buffer.concat(chunks)));
  request.on('error', reject);
});

export const readJson = async request => {
  const raw = await readBody(request);
  try { return JSON.parse(raw.toString('utf8') || '{}'); } catch { throw new HttpError(400, 'invalid_json'); }
};

/** Reads a JSON object (not an array or a primitive), or throws 400 with the given code. */
export const readObject = async (request, code = 'invalid_event') => {
  const value = await readJson(request);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, code);
  return value;
};

// Session cookie: HttpOnly, SameSite=Strict, Secure over HTTPS.
export const cookieOf = request => { const m = /(?:^|;\s*)rf_session=([\w-]+)/.exec(request.headers.cookie || ''); return m ? m[1] : ''; };
const secure = request => config.isProduction || request.headers['x-forwarded-proto'] === 'https';
export const sessionCookie = (request, token, maxAge) => `rf_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure(request) ? '; Secure' : ''}`;

// Behind Render's proxy every request comes from the proxy's address, so per-visitor limits read X-Forwarded-For when trusted.
export const clientIp = request => (config.trustProxy && String(request.headers['x-forwarded-for'] || '').split(',')[0].trim()) || request.socket.remoteAddress || '?';
