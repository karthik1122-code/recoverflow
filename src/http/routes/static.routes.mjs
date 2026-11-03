import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { reply, cookieOf, securityHeaders, HttpError } from '../respond.mjs';

const publicRoot = new URL('../../../public/', import.meta.url).pathname;
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

// Serves files from public/ only. Paths are normalised and checked to stay inside public/, so ../ tricks get 404.
// The dashboard pages redirect to the login page when sign-in is on and there is no session.
export async function staticRoutes({ request, response, url }, { auth, config }) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false;
  let requested; try { requested = decodeURIComponent(url.pathname); } catch { throw new HttpError(400, 'bad_path'); }
  if (requested === '/') requested = '/index.html';
  if (config.authOn && (requested === '/app.html' || requested === '/team.html') && !(await auth.userFromToken(cookieOf(request)))) {
    response.writeHead(302, { location: '/login.html', ...securityHeaders });
    response.end();
    return true;
  }
  const path = normalize(join(publicRoot, requested));
  const type = mime[extname(path)];
  const inside = path.startsWith(publicRoot.endsWith(sep) ? publicRoot : publicRoot + sep);
  if (!inside || !type) return reply(response, 404, { error: 'not found' });
  let file; try { file = await readFile(path); } catch { return reply(response, 404, { error: 'not found' }); }
  response.writeHead(200, { 'content-type': type, 'cache-control': requested === '/index.html' ? 'no-cache' : 'public, max-age=300', ...securityHeaders });
  response.end(request.method === 'HEAD' ? undefined : file);
  return true;
}
