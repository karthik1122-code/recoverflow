import { reply, cookieOf, HttpError } from './respond.mjs';
import { authRoutes } from './routes/auth.routes.mjs';
import { playRoutes, recoveryRoutes } from './routes/recovery.routes.mjs';
import { usersRoutes } from './routes/users.routes.mjs';
import { webhookRoutes } from './routes/webhook.routes.mjs';
import { healthRoutes, opsRoutes } from './routes/ops.routes.mjs';
import { staticRoutes } from './routes/static.routes.mjs';

const DEMO_USER = { id: 'demo', email: 'demo@local', name: 'Demo', role: 'admin' };

// Public routes run before the sign-in check; the rest need a signed-in user for /api/*.
const PUBLIC = [authRoutes, playRoutes];
const PRIVATE = [usersRoutes, webhookRoutes, recoveryRoutes, opsRoutes, healthRoutes, staticRoutes];

/**
 * Builds the request handler. Each route function returns true when it replied, false to pass the request on.
 *   request -> CSRF check -> who is signed in -> public routes -> sign-in check -> private routes -> 404
 */
export function createHandler(deps) {
  const { auth, metrics, config } = deps;
  return async function handle(request, response) {
    const url = new URL(request.url, `http://${request.headers.host}`);
    try {
      // Browsers cannot add a custom header cross-site without a CORS preflight, and this server sends no CORS headers.
      const mutating = request.method !== 'GET' && request.method !== 'HEAD';
      if (url.pathname.startsWith('/api/') && mutating && !request.headers['x-ag-csrf']) return reply(response, 403, { error: 'csrf_header_required' });

      const token = cookieOf(request);
      const user = config.authOn ? await auth.userFromToken(token) : DEMO_USER;
      // need(role) replies 403 and returns true when the user lacks the role.
      const need = role => (auth.can(user, role) ? false : reply(response, 403, { error: 'forbidden', message: `this needs the ${role} role` }));
      const ctx = { request, response, url, user, token, need };

      for (const route of PUBLIC) if (await route(ctx, deps)) return;
      if (url.pathname.startsWith('/api/') && !user) return reply(response, 401, { error: 'sign_in_required' });
      for (const route of PRIVATE) if (await route(ctx, deps)) return;
      reply(response, 404, { error: 'not found' });
    } catch (error) {
      if (error instanceof HttpError) return reply(response, error.status, { error: error.code });
      console.error(error);
      if (url.pathname === '/webhooks/razorpay') metrics.record('errors');
      reply(response, 500, { error: 'internal_error' });
    }
  };
}
