import { announce, thud } from './sound.js';

const $ = id => document.getElementById(id);
const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = ms => new Promise(r => setTimeout(r, ms));

/* Header: transparent over the counter, solid after it */
const top = $('top');
const hero = document.querySelector('.hero');
const onScroll = () => top.classList.toggle('scrolled', window.scrollY > hero.offsetHeight - 80);
window.addEventListener('scroll', onScroll, { passive: true }); onScroll();

const themeBtn = $('themeBtn');
const syncTheme = () => { themeBtn.textContent = document.documentElement.dataset.theme === 'dark' ? 'Light' : 'Dark'; };
themeBtn.addEventListener('click', () => { window.rfToggleTheme(); syncTheme(); }); syncTheme();

/* Sound: on unless the visitor turned it off before. It only ever plays after a press. */
let soundOn = true;
try { soundOn = localStorage.getItem('rf-sound') !== 'off'; } catch { /* storage blocked */ }
const soundBtn = $('soundBtn');
const syncSound = () => { soundBtn.setAttribute('aria-pressed', String(soundOn)); $('soundLabel').textContent = soundOn ? 'Sound on' : 'Sound off'; };
soundBtn.addEventListener('click', () => { soundOn = !soundOn; try { localStorage.setItem('rf-sound', soundOn ? 'on' : 'off'); } catch { /* ignore */ } syncSound(); if (!soundOn) speechSynthesis?.cancel(); });
syncSound();

/* The soundbox */
const cases = [
  { id: 'pay_Q8L2', amount: 2499, who: 'Ananya', where: 'Pune', why: 'Bank timed out after OTP' },
  { id: 'pay_F6R9', amount: 4899, who: 'Rohan', where: 'Mumbai', why: 'Balance was low on payday eve' },
  { id: 'pay_M2K7', amount: 18999, who: 'Vikram', where: 'Bengaluru', why: 'UPI mandate expired' },
  { id: 'pay_T9A1', amount: 1299, who: 'Meher', where: 'Jaipur', why: 'UPI request expired' },
  { id: 'pay_H3C5', amount: 6999, who: 'Krish', where: 'Hyderabad', why: 'Gateway timed out' },
];
let at = 0, tally = 0, busy = false;
const box = $('box'), lcd = $('lcd'), press = $('press'), slip = $('slip'), stamp = $('slipStamp');

function showCase(c, { animate = true } = {}) {
  $('slipId').textContent = c.id;
  $('slipAmt').textContent = inr.format(c.amount);
  $('slipWho').textContent = `${c.who}, ${c.where}`;
  $('slipWhy').textContent = c.why;
  stamp.textContent = 'Failed';
  stamp.className = 'stamp slip-stamp';
  box.classList.remove('won');
  lcd.textContent = '1 FAILED';
  if (animate && !reduce) { slip.classList.remove('in', 'out'); void slip.offsetWidth; slip.classList.add('in'); }
}

async function boot() {
  if (reduce) { lcd.textContent = '1 FAILED'; return; }
  for (const line of ['BOOTING', 'RAZORPAY…', 'CONNECTED', '3 FAILED']) { lcd.textContent = line; await wait(420); }
  lcd.textContent = '1 FAILED';
}

async function recover() {
  if (busy) return;
  busy = true; press.disabled = true;
  const c = cases[at % cases.length];
  press.classList.add('down'); setTimeout(() => press.classList.remove('down'), 140);
  lcd.textContent = 'SENDING';
  if (!reduce) { const chip = $('chip'); chip.textContent = `rzp.io/l/${c.id.slice(4).toLowerCase()}`; chip.classList.remove('fly'); void chip.offsetWidth; chip.classList.add('fly'); }
  await wait(reduce ? 200 : 1000);
  lcd.textContent = 'CUSTOMER PAID';
  await wait(reduce ? 100 : 500);
  box.classList.add('won', 'speaking');
  lcd.textContent = `₹${c.amount.toLocaleString('en-IN')} RCVD`;
  stamp.innerHTML = `Recovered<small>${inr.format(c.amount)}</small>`;
  stamp.className = 'stamp slip-stamp is-back slam';
  tally += c.amount;
  $('tally').textContent = inr.format(tally);
  slip.setAttribute('aria-label', `${inr.format(c.amount)} recovered from ${c.who}`);
  if (soundOn) await announce(c.amount, c.who); else await wait(1400);
  box.classList.remove('speaking');
  await wait(700);
  if (!reduce) { slip.classList.remove('in'); slip.classList.add('out'); await wait(420); }
  at += 1;
  showCase(cases[at % cases.length]);
  if (soundOn) thud();
  busy = false; press.disabled = false;
}
press.addEventListener('click', recover);
document.addEventListener('keydown', e => {
  if (e.code !== 'Space' || e.target.closest('input, textarea, select, button, a, summary')) return;
  const r = hero.getBoundingClientRect();
  if (r.bottom < 0 || r.top > innerHeight) return; // only while the counter is on screen
  e.preventDefault(); recover();
});

/* The box leans toward the pointer */
if (!reduce && window.matchMedia('(hover: hover)').matches) {
  const wrap = $('boxWrap');
  hero.addEventListener('pointermove', e => {
    const r = wrap.getBoundingClientRect();
    const x = (e.clientX - (r.left + r.width / 2)) / innerWidth, y = (e.clientY - (r.top + r.height / 2)) / innerHeight;
    box.style.setProperty('--ry', `${(-14 + x * 22).toFixed(2)}deg`);
    box.style.setProperty('--rx', `${(6 - y * 14).toFixed(2)}deg`);
  });
  hero.addEventListener('pointerleave', () => { box.style.removeProperty('--ry'); box.style.removeProperty('--rx'); });
}
showCase(cases[0], { animate: false });
boot();

/* Story: the stage starts complete (step 4) so the page reads without script; scrolling walks through it */
const story = document.querySelector('.story'), stage = $('stage');
if (!reduce) {
  const step = () => {
    const r = story.getBoundingClientRect();
    const span = story.offsetHeight - stage.offsetHeight;
    const p = Math.min(1, Math.max(0, -r.top / Math.max(1, span)));
    stage.dataset.step = String(Math.min(3, Math.floor(p * 4)));
  };
  window.addEventListener('scroll', step, { passive: true }); window.addEventListener('resize', step); step();
}

/* Proof chart */
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
if (!reduce && 'IntersectionObserver' in window) {
  chart.classList.add('armed');
  new IntersectionObserver((e, o) => { if (e.some(x => x.isIntersecting)) { chart.classList.add('shown'); o.disconnect(); } }, { threshold: .3 }).observe(chart);
}

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
