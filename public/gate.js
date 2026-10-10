// Loaded before app.js. Adds the CSRF header to same-origin writes, sends signed-out visitors to the sign-in page,
// and shows who is signed in. Text is inserted with textContent only.
(function () {
  const orig = window.fetch.bind(window);
  window.fetch = function (input, init) {
    init = init || {};
    const url = typeof input === 'string' ? input : input.url;
    const same = url.startsWith('/') || url.startsWith(location.origin);
    if (same && init.method && init.method.toUpperCase() !== 'GET') init.headers = Object.assign({ 'x-ag-csrf': '1' }, init.headers || {});
    return orig(input, init).then(res => { if (res.status === 401 && same && !url.includes('/api/auth/')) location.replace('/login.html'); return res; });
  };
  const mk = (tag, text, cls) => { const n = document.createElement(tag); if (text) n.textContent = text; if (cls) n.className = cls; return n; };
  orig('/api/auth/me').then(r => r.json()).then(me => {
    if (!me.authEnabled) { const b = document.querySelector('.side-meta'); if (b) { const note = mk('small', 'Demo mode: no sign-in'); b.before(note); } return; }
    if (!me.user) { location.replace('/login.html'); return; }
    const host = document.querySelector('.side-bottom'); if (!host) return;
    const chip = mk('div', '', 'userchip'); const who = mk('div'); who.append(mk('b', me.user.name), mk('span', `${me.user.role} · ${me.user.email}`)); chip.append(who);
    const row = mk('div', '', 'row');
    if (me.user.role === 'admin') { const a = mk('a', 'Team'); a.href = '/team.html'; row.append(a); }
    const out = mk('button', 'Sign out'); out.type = 'button';
    out.addEventListener('click', async () => { await orig('/api/auth/logout', { method: 'POST', headers: { 'x-ag-csrf': '1', 'content-type': 'application/json' }, body: '{}' }); location.replace('/login.html'); });
    row.append(out); chip.append(row); host.prepend(chip);
  }).catch(() => {});
})();
