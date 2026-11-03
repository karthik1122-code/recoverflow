import { AuthError } from '../../auth/auth.mjs';
import { reply, readJson } from '../respond.mjs';
import { replyAuthError } from './auth.routes.mjs';

// /api/users (admin only): list, add, remove people.
export async function usersRoutes({ request, response, url, user, need }, { auth }) {
  const path = url.pathname;
  if (path !== '/api/users' && !/^\/api\/users\/[\w-]+$/.test(path)) return false;
  if (need('admin')) return true;
  try {
    if (request.method === 'GET' && path === '/api/users') return reply(response, 200, await auth.listUsers());
    if (request.method === 'POST' && path === '/api/users') return reply(response, 201, await auth.createUser(await readJson(request)));
    if (request.method === 'DELETE') { await auth.deleteUser(path.split('/').pop(), user.id); return reply(response, 200, { ok: true }); }
  } catch (e) { if (e instanceof AuthError) return replyAuthError(response, e); throw e; }
  return false;
}
