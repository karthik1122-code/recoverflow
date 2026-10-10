const $ = id => document.getElementById(id);
const hdr = { 'content-type': 'application/json', 'x-ag-csrf': '1' };
const me = await fetch('/api/auth/me').then(r => r.json()).catch(() => null);
if (me && (me.user && me.authEnabled)) location.replace('/app.html');
if (me && !me.authEnabled) location.replace('/app.html');
const setup = !!(me && me.needsSetup);
if (setup) {
  $('title').textContent = 'Set up RecoverFlow';
  $('lede').textContent = 'Create the first administrator. They can add approvers and viewers afterwards.';
  $('fn').hidden = false; $('pl').textContent = 'Password (10 characters or more)'; $('password').autocomplete = 'new-password';
  $('ft').hidden = !me.setupTokenRequired; $('go').textContent = 'Create administrator';
}
$('form').addEventListener('submit', async e => {
  e.preventDefault(); $('err').textContent = ''; $('go').disabled = true;
  try {
    const res = await fetch(setup ? '/api/auth/setup' : '/api/auth/login', { method: 'POST', headers: hdr, body: JSON.stringify({ name: $('name').value, email: $('email').value, password: $('password').value, setupToken: $('setupToken').value }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || data.error || 'Something went wrong');
    location.replace('/app.html');
  } catch (x) { $('err').textContent = x.message; $('go').disabled = false; }
});
