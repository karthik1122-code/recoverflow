const $ = id => document.getElementById(id);
const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* Header border once the page scrolls */
const top = document.querySelector('.top');
const onScroll = () => top.classList.toggle('scrolled', window.scrollY > 8);
window.addEventListener('scroll', onScroll, { passive: true }); onScroll();

/* Theme */
const themeBtn = $('themeBtn');
const syncTheme = () => { themeBtn.textContent = document.documentElement.dataset.theme === 'dark' ? 'Light' : 'Dark'; };
themeBtn.addEventListener('click', () => { window.rfToggleTheme(); syncTheme(); }); syncTheme();

/* Hero: the one orchestrated moment. Steps appear, then the RECOVERED stamp lands. */
const scene = document.querySelector('.hero-scene');
const steps = [...document.querySelectorAll('#heroSteps li')];
const timers = [];
function play() {
  timers.splice(0).forEach(clearTimeout);
  $('replay').hidden = true;
  if (reduce) { scene.classList.add('done'); return; }
  scene.classList.remove('done');
  scene.classList.add('playing');
  steps.forEach(s => s.classList.remove('on'));
  steps.forEach((s, i) => timers.push(setTimeout(() => s.classList.add('on'), 900 + i * 900)));
  timers.push(setTimeout(() => { scene.classList.add('done'); scene.classList.remove('playing'); }, 900 + steps.length * 900 + 250));
  timers.push(setTimeout(() => { $('replay').hidden = false; }, 900 + steps.length * 900 + 1200));
}
$('replay').addEventListener('click', play);
// Start when the receipt is on screen, so people on small phones still see it happen.
new IntersectionObserver((entries, obs) => { if (entries.some(e => e.isIntersecting)) { play(); obs.disconnect(); } }, { threshold: .4 }).observe(scene);

/* Calculator */
const salesSteps = [];
for (let v = 100000; v <= 10000000; v = Math.round(v * 1.0472 / 1000) * 1000) salesSteps.push(v);
salesSteps.push(10000000);
const sales = $('cSales'); sales.max = String(salesSteps.length - 1);
const lakhs = v => v >= 10000000 ? '₹1 crore' : `₹${(v / 100000).toLocaleString('en-IN', { maximumFractionDigits: v < 1000000 ? 1 : 0 })} lakh`;
function calc() {
  const s = salesSteps[Number(sales.value)] || salesSteps.at(-1);
  const f = Number($('cFail').value) / 100;
  const r = Number($('cRec').value) / 100;
  // Treat the failure share as a share of attempted value: failed ≈ sales × f / (1 − f).
  const failed = s * f / (1 - f);
  const back = failed * r;
  const fee = back * 0.08;
  $('oSales').textContent = lakhs(s);
  $('oFail').textContent = `${Math.round(f * 100)}%`;
  $('oRec').textContent = `${Math.round(r * 100)}%`;
  $('outFail').textContent = inr.format(failed);
  $('outBack').textContent = inr.format(back);
  $('outFee').textContent = inr.format(fee);
  $('outKeep').textContent = inr.format(back - fee);
  for (const el of [sales, $('cFail'), $('cRec')]) el.style.setProperty('--fill', `${((el.value - el.min) / (el.max - el.min)) * 100}%`);
}
sales.value = String(salesSteps.findIndex(v => v >= 1000000));
$('calc').addEventListener('input', calc); calc();

/* Pilot form */
$('pilotForm').addEventListener('submit', async e => {
  e.preventDefault();
  const form = e.currentTarget, err = $('pErr'), go = $('pGo');
  err.textContent = '';
  const data = Object.fromEntries(new FormData(form));
  const missing = [['name', 'your name'], ['store', 'your store'], ['contact', 'an email or WhatsApp number']].filter(([k]) => !String(data[k] || '').trim());
  if (missing.length) { err.textContent = `Add ${missing.map(m => m[1]).join(', ')}.`; form.querySelector(`[name="${missing[0][0]}"]`).focus(); return; }
  go.disabled = true; go.textContent = 'Sending…';
  try {
    const res = await fetch('/api/pilot-request', { method: 'POST', headers: { 'content-type': 'application/json', 'x-ag-csrf': '1' }, body: JSON.stringify(data) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.message || 'The request did not go through. Try again in a minute.');
    form.hidden = true;
    $('pilotDone').hidden = false;
    $('pilotDone').focus();
  } catch (x) {
    err.textContent = x.message;
    go.disabled = false; go.textContent = 'Request a pilot';
  }
});
