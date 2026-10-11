const $ = id => document.getElementById(id);
const J = { 'content-type': 'application/json', 'x-ag-csrf': '1' };
const toast = m => { const t = document.createElement('div'); t.className = 'toast'; t.textContent = m; document.body.append(t); setTimeout(() => t.remove(), 3000); };
const me = await fetch('/api/auth/me').then(r => r.json());
async function load() {
  const res = await fetch('/api/users'); if (res.status === 403) { $('rows').textContent = 'Only administrators can manage the team.'; return; }
  const users = await res.json(); const body = $('rows'); body.replaceChildren();
  for (const u of users) {
    const tr = document.createElement('tr');
    for (const v of [u.name, u.email, u.role]) { const td = document.createElement('td'); td.textContent = v; tr.append(td); }
    const td = document.createElement('td');
    if (me.user && u.id === me.user.id) td.textContent = 'you';
    else { const b = document.createElement('button'); b.className = 'btn btn-ghost'; b.type = 'button'; b.textContent = 'Remove';
      b.addEventListener('click', async () => { if (!confirm(`Remove ${u.email}? Their sessions end immediately.`)) return; const r = await fetch(`/api/users/${u.id}`, { method: 'DELETE', headers: J }); if (r.ok) { toast('Removed'); load(); } else toast((await r.json()).message || 'Could not remove'); });
      td.append(b); }
    tr.append(td); body.append(tr);
  }
}
$('form').addEventListener('submit', async e => {
  e.preventDefault(); $('err').textContent = '';
  const r = await fetch('/api/users', { method: 'POST', headers: J, body: JSON.stringify({ name: $('n').value, email: $('e').value, password: $('p').value, role: $('r').value }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { $('err').textContent = d.message || d.error; return; }
  toast('Person added'); $('form').reset(); load();
});
load();
