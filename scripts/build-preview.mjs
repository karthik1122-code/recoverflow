// Builds a server-free preview of the site and dashboard into dist-preview/.
// The pages are the real ones; preview/shim.js + preview/backend.mjs answer /api/* in the browser.
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const out = join(root, 'dist-preview');
await rm(out, { recursive: true, force: true });
await mkdir(join(out, 'lib'), { recursive: true });

const skip = new Set(['login.html', 'team.html', 'login.js', 'team.js', 'auth.css']);
for (const f of await readdir(join(root, 'public'))) if (!skip.has(f)) await cp(join(root, 'public', f), join(out, f), { recursive: true });
for (const f of ['core.mjs', 'cases.mjs', 'report.mjs', 'demo.mjs', 'events.mjs']) await cp(join(root, f), join(out, 'lib', f));
await cp(join(root, 'preview', 'shim.js'), join(out, 'preview-shim.js'));
await cp(join(root, 'preview', 'sha256.mjs'), join(out, 'sha256.mjs'));
await cp(join(root, 'preview', 'backend.mjs'), join(out, 'preview-backend.mjs'));

const inject = '<script src="theme.js"></script>\n<script src="preview-shim.js"></script>\n<script type="module" src="preview-backend.mjs"></script>';
for (const page of ['index.html', 'app.html']) {
  let html = await readFile(join(out, page), 'utf8');
  if (!html.includes('<script src="theme.js"></script>')) throw new Error(`${page}: theme.js tag not found`);
  html = html.replace('<script src="theme.js"></script>', inject)
    .replaceAll('href="/demo"', 'href="app.html"')
    .replaceAll('href="/login.html"', 'href="app.html"')
    .replaceAll('href="/"', 'href="index.html"')
    .replaceAll('href="/app.html', 'href="app.html');
  if (/(href|src)="\/(?!\/)/.test(html)) throw new Error(`${page}: an absolute local link is left over`);
  await writeFile(join(out, page), html);
}
console.log(`Preview built in ${out}`);

// Artifact pages: claude.ai wraps the published page in its own document skeleton, cannot print,
// and opens https links in a new tab. DEMO_LINK points the site's demo buttons at the published dashboard.
const demoLink = process.env.DEMO_LINK || 'app.html';
const unwrap = html => html
  .replace(/<!doctype html>\s*/i, '')
  .replace(/<html[^>]*>\s*/i, '').replace(/\s*<\/html>\s*$/i, '\n')
  .replace(/<head>\s*/i, '').replace(/\s*<\/head>\s*/i, '\n')
  .replace(/<body>\s*/i, '').replace(/\s*<\/body>/i, '')
  .replace(/<meta charset="UTF-8">\s*/i, '').replace(/<meta name="viewport"[^>]*>\s*/i, '');
{
  let site = unwrap(await readFile(join(out, 'index.html'), 'utf8'))
    .replace(/<title>[^<]*<\/title>/, '<title>RecoverFlow</title>')
    .replaceAll('href="app.html"', `href="${demoLink}"${demoLink.startsWith('http') ? ' target="_blank" rel="noopener"' : ''}`)
    .replace(/<a href="https:\/\/github\.com[^>]*>GitHub<\/a>/, '');
  await writeFile(join(out, 'artifact-site.html'), site);
  let app = unwrap(await readFile(join(out, 'app.html'), 'utf8'))
    .replace(/<title>[^<]*<\/title>/, '<title>RecoverFlow Demo</title>')
    .replace(/\s*<button class="btn" type="button" id="printBtn">[^<]*<\/button>/, '')
    .replace('What came back, ready to print or save as a PDF for the store owner.', 'What came back, in the form a store owner gets each week.');
  if (app.includes('printBtn')) throw new Error('print button still present');
  await writeFile(join(out, 'artifact-app.html'), app);
}
console.log(`Artifact pages built (demo link: ${demoLink})`);
