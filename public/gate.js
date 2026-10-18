// Loaded before app.js. Adds the CSRF header to same-origin writes, sends signed-out visitors
// to the sign-in page, and shows who is signed in. Text is inserted with textContent only.
(function () {
  const orig = window.fetch.bind(window);
  window.fetch = function (input, init) {
    init = init || {};
    const url = typeof input === 'string' ? input : input.url;
    const same = url.startsWith('/') || url.startsWith(location.origin);
    if (same && init.method && init.method.toUpperCase() !== 'GET') init.headers = Object.assign({ 'x-ag-csrf': '1', 'content-type': 'application/json' }, init.headers || {});
    return orig(input, init).then(res => { if (res.status === 401 && same && !url.includes('/api/auth/')) location.replace('/login.html'); return res; });
  };
  const mk = (tag, text, cls) => { const n = document.createElement(tag); if (text) n.textContent = text; if (cls) n.className = cls; return n; };
  window.rfMe = orig('/api/auth/me').then(r => r.json()).then(me => {
    const host = () => document.getElementById('who');
    const render = () => {
      const h = host(); if (!h) return;
      if (!me.authEnabled) { h.append(mk('p', 'Demo workspace', 'who-name'), mk('p', 'No sign-in needed', 'who-meta')); return; }
      if (!me.user) return;
      h.append(mk('p', me.user.name, 'who-name'), mk('p', `${me.user.role} · ${me.user.email}`, 'who-meta'));
      const row = mk('div', '', 'who-row');
      if (me.user.role === 'admin') { const a = mk('a', 'Team', 'btn btn-quiet btn-sm'); a.href = '/team.html'; row.append(a); }
      const out = mk('button', 'Sign out', 'btn btn-quiet btn-sm'); out.type = 'button';
      out.addEventListener('click', async () => { await orig('/api/auth/logout', { method: 'POST', headers: { 'x-ag-csrf': '1', 'content-type': 'application/json' }, body: '{}' }); location.replace('/login.html'); });
      row.append(out); h.append(row);
    };
    if (me.authEnabled && !me.user) { location.replace('/login.html'); return me; }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render); else render();
    return me;
  }).catch(() => ({}));
})();
