import { AuthError } from '../../auth/auth.mjs';
import { reply, readJson, sessionCookie, clientIp } from '../respond.mjs';

const authStatus = code => ({ bad_credentials: 401, locked: 429, already_set_up: 409, email_taken: 409, not_found: 404, self_delete: 409, last_admin: 409 }[code] || 400);
export const replyAuthError = (response, e) => reply(response, authStatus(e.code), { error: e.code, message: e.message });

// GET /api/auth/me, POST /api/auth/setup | login | logout. All public: they run before the sign-in check.
export async function authRoutes({ request, response, url, user, token }, { auth, config }) {
  const { method } = request; const path = url.pathname;
  if (method === 'GET' && path === '/api/auth/me') {
    return reply(response, 200, { authEnabled: config.authOn, needsSetup: config.authOn && await auth.needsSetup(), setupTokenRequired: !!config.setupToken, user });
  }
  if (!config.authOn || method !== 'POST') return false;
  const signIn = async body => {
    const s = await auth.login(body.email, body.password, clientIp(request));
    return { user: s.user, cookie: sessionCookie(request, s.token, s.maxAge) };
  };
  try {
    // The first account becomes the admin. SETUP_TOKEN stops a stranger claiming it first.
    if (path === '/api/auth/setup') {
      const body = await readJson(request);
      if (config.setupToken && body.setupToken !== config.setupToken) return reply(response, 403, { error: 'invalid_setup_token', message: 'The setup token is wrong.' });
      await auth.setup(body);
      const s = await signIn(body);
      return reply(response, 201, { user: s.user }, { 'set-cookie': s.cookie });
    }
    if (path === '/api/auth/login') {
      const s = await signIn(await readJson(request));
      return reply(response, 200, { user: s.user }, { 'set-cookie': s.cookie });
    }
  } catch (e) { if (e instanceof AuthError) return replyAuthError(response, e); throw e; }
  if (path === '/api/auth/logout') {
    await auth.logout(token);
    return reply(response, 200, { ok: true }, { 'set-cookie': sessionCookie(request, '', 0) });
  }
  return false;
}
