const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const fine = matchMedia('(pointer: fine)').matches;

/* ---- theme ---- */
const setTheme = t => { document.documentElement.setAttribute('data-theme', t); try { localStorage.setItem('rf-theme', t); } catch {} };
const toggleTheme = () => setTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light');
$('#themeToggle').addEventListener('click', toggleTheme);
addEventListener('keydown', e => { if (e.key.toLowerCase() === 't' && !e.metaKey && !e.ctrlKey && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) toggleTheme(); });

/* ---- split headline into animated characters ---- */
let ci = 0;
$$('[data-split]').forEach(el => {
  const text = el.textContent; el.textContent = ''; el.setAttribute('aria-hidden', 'true');
  const total = text.length; let k = 0;
  text.split(/(\s+)/).forEach(word => {
    if (/^\s+$/.test(word)) { el.appendChild(document.createTextNode(' ')); k += word.length; return; }
    const w = document.createElement('span'); w.className = 'word';
    [...word].forEach(c => { const s = document.createElement('span'); s.className = 'ch'; s.style.setProperty('--i', ci++); s.style.setProperty('--p', (k++ / Math.max(1, total - 1) * 100).toFixed(1) + '%'); s.textContent = c; w.appendChild(s); });
    el.appendChild(w);
  });
});

/* ---- scroll progress, nav, cursor glow ---- */
const progress = $('#progress'), nav = $('#nav');
const onScroll = () => {
  const h = document.documentElement; const max = h.scrollHeight - innerHeight;
  progress.style.transform = `scaleX(${max > 0 ? scrollY / max : 0})`;
  nav.classList.toggle('scrolled', scrollY > 20);
};
addEventListener('scroll', onScroll, { passive: true }); onScroll();
if (fine && !reduce) {
  const g = $('#cursorGlow'); g.style.opacity = 1;
  addEventListener('pointermove', e => { g.style.transform = `translate(${e.clientX}px,${e.clientY}px)`; }, { passive: true });
}

/* ---- reveal on scroll + count-up ---- */
const countUp = el => {
  const to = +el.dataset.count, suf = el.dataset.suffix || ''; if (reduce || to === 0) { el.textContent = to + suf; return; }
  const t0 = performance.now(), dur = 1400;
  const f = now => { const p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 4); el.textContent = Math.round(to * e) + suf; if (p < 1) requestAnimationFrame(f); };
  requestAnimationFrame(f);
};
$$('.reveal').forEach((el, i) => el.style.setProperty('--d', `${(i % 4) * 80}ms`));
const io = new IntersectionObserver(es => es.forEach(e => {
  if (!e.isIntersecting) return; e.target.classList.add('in');
  $$('[data-count]', e.target).forEach(countUp); if (e.target.matches('[data-count]')) countUp(e.target);
  io.unobserve(e.target);
}), { threshold: .18 });
$$('.reveal').forEach(el => io.observe(el));
$$('.trust b[data-count]').forEach(el => setTimeout(() => countUp(el), 1500));

/* ---- rotating words ---- */
const words = ['OTP timeouts', 'failed UPI mandates', 'overdue B2B invoices', 'abandoned checkouts', 'duplicate charges'];
const rot = $('#rot'); let wi = 0;
if (!reduce) setInterval(() => {
  rot.classList.add('out');
  setTimeout(() => { wi = (wi + 1) % words.length; rot.textContent = words[wi]; rot.classList.remove('out'); rot.classList.add('in'); void rot.offsetWidth; rot.classList.remove('in'); }, 480);
}, 2400);

/* ---- marquee ---- */
const tags = ['issuer timeouts', 'insufficient funds', 'UPI mandate failures', 'overdue invoices', 'abandoned carts', 'duplicate charges', 'retry-limit breaches', 'consent refusals', 'unknown errors'];
$('#track').innerHTML = [...tags, ...tags].map(t => `<span>${t}</span>`).join('');

/* ---- live engine stream (real /api/diagnose) ---- */
const SAMPLES = [
  { n: 'Mira Patel', e: { id: 'ld_1', amount: 1249900, error_description: 'issuer network timeout after OTP', customer_opted_in: true, retry_count: 0 } },
  { n: 'Aarav Mehta', e: { id: 'ld_2', amount: 899900, error_description: 'insufficient balance', customer_opted_in: true, retry_count: 0 } },
  { n: 'Nora Collective', e: { id: 'ld_3', amount: 780000, duplicate_suspected: true, customer_opted_in: true, retry_count: 0 } },
  { n: 'Studio Nila', e: { id: 'ld_4', amount: 4500000, error_description: 'invoice overdue 14 days', customer_opted_in: true, retry_count: 0 } },
  { n: 'Kabir Shah', e: { id: 'ld_5', amount: 650000, error_description: 'insufficient balance', customer_opted_in: false, retry_count: 0 } },
  { n: 'Kavya Iyer', e: { id: 'ld_6', amount: 1199900, error_description: 'issuer timeout', customer_opted_in: true, retry_count: 1 } },
  { n: 'Orbit Labs', e: { id: 'ld_7', amount: 62000000, error_description: 'issuer network timeout after OTP', customer_opted_in: true, retry_count: 0 } },
];
const inr = p => '₹' + (p / 100).toLocaleString('en-IN');
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const stream = $('#stream'), stat = $('#engineStat');
let si = 0, handled = 0, held = 0, live = true;
async function classify(sample) {
  try {
    const r = await fetch('/api/diagnose', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(sample.e) });
    if (!r.ok) throw 0; return await r.json();
  } catch { live = false; return null; }
}
async function tick() {
  const s = SAMPLES[si++ % SAMPLES.length]; const d = await classify(s); if (!d) { stat.textContent = 'Engine offline — start the server to see live decisions'; return; }
  handled++; const code = d.decision.policy_code; const ok = d.decision.status === 'approval_required'; if (!ok) held++;
  const cls = ok ? 'ok' : code === 'HIGH_VALUE_REVIEW' ? 'rev' : 'hold';
  const li = document.createElement('li'); li.className = 'ev';
  li.innerHTML = `<span class="av">${esc(s.n.split(' ').map(w => w[0]).join('').slice(0, 2))}</span><div><b>${esc(s.n)}</b><small>${esc(d.diagnosis.label.replaceAll('_', ' '))} · ${Math.round(d.diagnosis.confidence * 100)}%</small></div><div class="rt"><span class="amt">${inr(s.e.amount)}</span><br><span class="tag ${cls}">${esc(code)}</span></div>`;
  stream.prepend(li); while (stream.children.length > 5) stream.lastElementChild.remove();
  stat.textContent = `${handled} diagnosed · ${held} held by policy · 0 auto-actions`;
}
tick(); setInterval(tick, 2300);

/* ---- tilt + spotlight on cards ---- */
if (fine && !reduce) $$('.tilt').forEach(el => {
  el.addEventListener('pointermove', e => {
    const r = el.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    el.style.setProperty('--px', x * 100 + '%'); el.style.setProperty('--py', y * 100 + '%');
    el.style.transform = `perspective(900px) rotateX(${(.5 - y) * 6}deg) rotateY(${(x - .5) * 8}deg) translateY(-3px)`;
  });
  el.addEventListener('pointerleave', () => { el.style.transform = ''; });
});

/* ---- magnetic buttons ---- */
if (fine && !reduce) $$('.magnetic').forEach(b => {
  b.addEventListener('pointermove', e => { const r = b.getBoundingClientRect(); b.style.setProperty('--mx', (e.clientX - r.left - r.width / 2) * .18 + 'px'); b.style.setProperty('--my', (e.clientY - r.top - r.height / 2) * .28 + 'px'); });
  b.addEventListener('pointerleave', () => { b.style.setProperty('--mx', '0px'); b.style.setProperty('--my', '0px'); });
});

/* ---- pipeline packet ---- */
const path = $('#pipePath'), packet = $('#packet');
if (path && !reduce) { const L = path.getTotalLength(); const t0 = performance.now(); const f = now => { const p = ((now - t0) / 5200) % 1; const pt = path.getPointAtLength(p * L); packet.setAttribute('cx', pt.x); packet.setAttribute('cy', pt.y); requestAnimationFrame(f); }; requestAnimationFrame(f); }

/* ---- signature typing ---- */
const sig = $('#sigDemo'); const hex = () => Array.from({ length: 24 }, () => '0123456789abcdef'[Math.random() * 16 | 0]).join('');
if (sig && !reduce) setInterval(() => { sig.textContent = 'sha256=' + hex() + '…'; }, 1600); else if (sig) sig.textContent = 'sha256=9f2c41e7…';

/* ---- audit chain ---- */
const chain = $('#chain'); const hh = () => Array.from({ length: 6 }, () => '0123456789abcdef'[Math.random() * 16 | 0]).join('');
let prev = '000000';
const addBlock = n => { const h = hh(); const el = document.createElement('div'); el.className = 'blk'; el.innerHTML = `<b>#${n}</b>prev ${prev}<br>hash ${h}`; prev = h; if (chain.children.length) { const l = document.createElement('i'); l.className = 'link'; chain.appendChild(l); } chain.appendChild(el); while (chain.children.length > 9) { chain.firstElementChild.remove(); chain.firstElementChild.remove(); } };
let bn = 1; for (; bn <= 5; bn++) addBlock(bn); if (!reduce) setInterval(() => addBlock(bn++), 2600);

/* ---- consent-safe message typing ---- */
const MSG = { en: 'Hi Mira — your ₹12,499 payment did not go through (bank timeout). Here is a secure link to complete it whenever you are ready. Reply STOP to opt out.', hi: 'Hi Mira — aapka ₹12,499 ka payment bank timeout ki wajah se complete nahi hua. Yeh secure link hai, jab chahein complete kar lein. Opt-out ke liye STOP reply karein.' };
const bubble = $('#bubble'); let typing = 0;
function type(lang) { const id = ++typing; const t = MSG[lang]; bubble.dataset.t = ''; let i = 0; bubble.firstChild && (bubble.textContent = ''); if (reduce) { bubble.textContent = t; return; } const step = () => { if (id !== typing) return; bubble.textContent = t.slice(0, ++i); if (i < t.length) setTimeout(step, 14); }; step(); }
$$('.seg button').forEach(b => b.addEventListener('click', () => { $$('.seg button').forEach(x => x.classList.toggle('on', x === b)); type(b.dataset.lang); }));
new IntersectionObserver((es, o) => { if (es[0].isIntersecting) { type('en'); o.disconnect(); } }, { threshold: .4 }).observe(bubble);

/* ---- decision lab code typing ---- */
const lab = $('#labCode');
const LAB = `<span class="k">"diagnosis"</span>: {\n  <span class="k">"label"</span>: <span class="s">"transient_bank_failure"</span>,\n  <span class="k">"confidence"</span>: <span class="n">0.94</span>,\n  <span class="k">"recommended_action"</span>: <span class="s">"Offer one delayed retry"</span>\n},\n<span class="k">"decision"</span>: {\n  <span class="k">"policy_code"</span>: <span class="s">"HUMAN_GATE"</span>\n}`;
new IntersectionObserver((es, o) => { if (!es[0].isIntersecting) return; o.disconnect(); if (reduce) { lab.innerHTML = LAB; return; } const plain = LAB.replace(/<[^>]+>/g, ''); let i = 0; const tick = () => { i = Math.min(plain.length, i + 3); let shown = 0, out = ''; for (const part of LAB.split(/(<[^>]+>)/)) { if (part.startsWith('<')) { out += part; continue; } const take = Math.max(0, Math.min(part.length, i - shown)); out += part.slice(0, take); shown += part.length; } lab.innerHTML = out + (i < plain.length ? '' : ''); if (i < plain.length) setTimeout(tick, 16); }; tick(); }, { threshold: .4 }).observe(lab);
