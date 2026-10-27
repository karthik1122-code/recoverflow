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
// Check the form before sending, so an empty field gets a clear message instead of a server error.
function problem() {
  if (setup && !$('name').value.trim()) return ['name', 'Enter your name.'];
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test($('email').value.trim())) return ['email', 'Enter a valid email address.'];
  if (!$('password').value) return ['password', 'Enter your password.'];
  if (setup && $('password').value.length < 10) return ['password', 'Use a password of 10 characters or more.'];
  if (setup && !$('ft').hidden && !$('setupToken').value) return ['setupToken', 'Enter the setup token from the server settings.'];
  return null;
}
$('form').addEventListener('submit', async e => {
  e.preventDefault(); $('err').textContent = '';
  const bad = problem();
  if (bad) { $('err').textContent = bad[1]; $(bad[0]).focus(); return; }
  $('go').disabled = true;
  try {
    const res = await fetch(setup ? '/api/auth/setup' : '/api/auth/login', { method: 'POST', headers: hdr, body: JSON.stringify({ name: $('name').value, email: $('email').value, password: $('password').value, setupToken: $('setupToken').value }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || data.error || 'Something went wrong. Please try again.');
    location.replace('/app.html');
  } catch (x) {
    $('err').textContent = x instanceof TypeError ? 'Cannot reach the server. If it was idle it may be waking up; try again in a few seconds.' : x.message;
    $('go').disabled = false;
  }
});
