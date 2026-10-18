const $ = id => document.getElementById(id);
const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* Header: marigold over the hero, solid once you scroll past it */
const top = $('top');
const hero = document.querySelector('.hero');
const onScroll = () => top.classList.toggle('scrolled', window.scrollY > hero.offsetHeight - 70);
window.addEventListener('scroll', onScroll, { passive: true }); onScroll();

const themeBtn = $('themeBtn');
const syncTheme = () => { themeBtn.textContent = document.documentElement.dataset.theme === 'dark' ? 'Light' : 'Dark'; };
themeBtn.addEventListener('click', () => { window.rfToggleTheme(); syncTheme(); }); syncTheme();

/* The announcer: cycles through recoveries; speaks only when you ask */
const recoveries = [
  { amount: 2499, words: 'two thousand four hundred and ninety nine', who: 'from Ananya in Pune. Her bank timed out at checkout.', short: 'Ananya, Pune' },
  { amount: 4899, words: 'four thousand eight hundred and ninety nine', who: 'from Rohan in Mumbai. His balance was low on payday eve.', short: 'Rohan, Mumbai' },
  { amount: 18999, words: 'eighteen thousand nine hundred and ninety nine', who: 'from Vikram in Bengaluru. His card needed updating.', short: 'Vikram, Bengaluru' },
  { amount: 1299, words: 'one thousand two hundred and ninety nine', who: 'from Meher in Jaipur. Her UPI request expired.', short: 'Meher, Jaipur' },
  { amount: 6999, words: 'six thousand nine hundred and ninety nine', who: 'from Krish in Hyderabad. The gateway timed out.', short: 'Krish, Hyderabad' },
];
let current = 0;
const wave = $('wave');
function renderFeed() {
  const earlier = [1, 2].map(k => recoveries[(current + k) % recoveries.length]);
  $('annFeed').innerHTML = earlier.map((r, i) => `<li><span>${r.short}</span><span><b>${inr.format(r.amount)}</b> ${i === 0 ? '2 hours ago' : 'yesterday'}</span></li>`).join('');
}
function show(i) {
  current = i % recoveries.length;
  const r = recoveries[current];
  const amt = $('annAmount');
  amt.textContent = inr.format(r.amount);
  $('annWho').textContent = r.who;
  if (!reduce) { amt.classList.remove('tick'); void amt.offsetWidth; amt.classList.add('tick'); }
  renderFeed();
}
show(0);
let cycle = reduce ? null : setInterval(() => show(current + 1), 4200);

const canSpeak = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
if (canSpeak) {
  const btn = $('hearBtn');
  btn.hidden = false;
  btn.addEventListener('click', () => {
    clearInterval(cycle); cycle = null;
    const r = recoveries[current];
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(`${r.words} rupees recovered`);
    const voices = speechSynthesis.getVoices();
    u.voice = voices.find(v => v.lang === 'en-IN') || voices.find(v => v.lang?.startsWith('en')) || null;
    u.lang = u.voice?.lang || 'en-IN';
    u.rate = 0.95;
    u.onstart = () => wave.classList.add('on');
    u.onend = u.onerror = () => { wave.classList.remove('on'); if (!reduce) cycle = setInterval(() => show(current + 1), 4200); };
    speechSynthesis.speak(u);
  });
}

/* Proof chart: two weeks from the demo store */
const days = [
  ['5', 6098, 0], ['6', 1199, 0], ['7', 2398, 2398], ['8', 1199, 0], ['9', 2398, 1499], ['10', 6896, 4498], ['11', 12394, 5097],
  ['12', 0, 0], ['13', 8094, 3398], ['14', 4198, 2098], ['15', 18996, 11997], ['16', 13395, 7297], ['17', 12496, 2499],
];
const chart = $('chart');
const max = Math.max(...days.map(d => d[1]));
chart.style.setProperty('--n', days.length);
chart.innerHTML = days.map(([d, failed, back]) => `
  <div class="col" tabindex="0">
    <div class="bar" style="height:${failed ? Math.max(3, (failed / max) * 100) : 0}%"><div class="in" style="height:${failed ? (back / failed) * 100 : 0}%"></div></div>
    <span class="day">${d} Oct</span>
    <span class="tip">${d} Oct: ${inr.format(failed)} failed, ${inr.format(back)} back</span>
  </div>`).join('');
const totalFailed = days.reduce((a, d) => a + d[1], 0), totalBack = days.reduce((a, d) => a + d[2], 0);
$('tFailed').textContent = inr.format(totalFailed);
$('tBack').textContent = inr.format(totalBack);
$('tShare').textContent = `${Math.round((totalBack / totalFailed) * 100)}%`;
if (reduce) chart.classList.add('shown');
else new IntersectionObserver((e, o) => { if (e.some(x => x.isIntersecting)) { chart.classList.add('shown'); o.disconnect(); } }, { threshold: .35 }).observe(chart);

/* Calculator */
const salesSteps = [];
for (let v = 100000; v <= 10000000; v = Math.round(v * 1.0472 / 1000) * 1000) salesSteps.push(v);
salesSteps.push(10000000);
const sales = $('cSales'); sales.max = String(salesSteps.length - 1);
const lakhs = v => v >= 10000000 ? '₹1 crore' : `₹${(v / 100000).toLocaleString('en-IN', { maximumFractionDigits: v < 1000000 ? 1 : 0 })} lakh`;
function calc() {
  const s = salesSteps[Number(sales.value)] || salesSteps.at(-1);
  const f = Number($('cFail').value) / 100, r = Number($('cRec').value) / 100;
  const failed = s * f / (1 - f), back = failed * r, fee = back * 0.08;
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
  const missing = [['name', 'your name'], ['contact', 'an email or WhatsApp number'], ['store', 'your store']].filter(([k]) => !String(data[k] || '').trim());
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
