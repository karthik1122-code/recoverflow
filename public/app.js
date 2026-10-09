'use strict';

/* ---------- data ---------- */
const labScenarios = {
  timeout: { id: 'lab_timeout', amount: 1249900, error_description: 'issuer network timeout after OTP', customer_opted_in: true, retry_count: 0 },
  funds: { id: 'lab_funds', amount: 899900, error_description: 'insufficient balance', customer_opted_in: true, retry_count: 0 },
  duplicate: { id: 'lab_duplicate', amount: 780000, duplicate_suspected: true, customer_opted_in: true, retry_count: 0 },
  consent: { id: 'lab_consent', amount: 650000, error_description: 'insufficient balance', customer_opted_in: false, retry_count: 0 },
  retry: { id: 'lab_retry', amount: 1199900, error_description: 'issuer timeout', customer_opted_in: true, retry_count: 1 },
};

const seedCases = [
  { id: 'pay_Q8L2', customer: 'Mira Patel', amount: 12499, cause: 'Bank timeout after OTP', driver: 'Bank timeout', confidence: 94, action: 'Retry at 09:30 + secure payment link', status: 'approve', evidence: 'Issuer timeout · previous successful UPI payments · customer still active' },
  { id: 'pay_F6R9', customer: 'Aarav Mehta', amount: 8999, cause: 'Insufficient balance', driver: 'Insufficient balance', confidence: 89, action: 'Send salary-day retry link', status: 'approve', evidence: 'NSF response · payday is tomorrow · consent is active' },
  { id: 'pay_B4K1', customer: 'Studio Nila', amount: 45000, cause: 'Invoice overdue, 14 days', driver: 'Overdue invoice', confidence: 96, action: 'Escalate to accounts owner', status: 'approve', evidence: 'B2B invoice · two reminders opened · no dispute flag' },
  { id: 'pay_Z2P7', customer: 'Kabir Shah', amount: 2499, cause: 'Checkout abandonment', driver: 'Abandoned checkout', confidence: 77, action: 'Send one cart reminder', status: 'approve', evidence: 'Cart open 8 mins · viewed shipping · opted in' },
  { id: 'pay_J1M5', customer: 'Kavya Iyer', amount: 11999, cause: 'Repeated mandate failure', driver: 'Mandate failure', confidence: 92, action: 'Hold — consent refresh needed', status: 'hold', evidence: '3 failures in 24h · retry limit reached' },
  { id: 'pay_H7V3', customer: 'Nora Collective', amount: 7800, cause: 'Possible duplicate charge', driver: 'Duplicate risk', confidence: 61, action: 'Hold — human review', status: 'hold', evidence: 'Duplicate fingerprint · low diagnostic confidence' },
];

let cases = structuredClone(seedCases);
let audit = [];
let filter = 'all';
let activeCase = null;
let swept = false;
let serverState = { online: false, events: [], audit: [], integrity: null };

/* ---------- helpers ---------- */
const $ = (id) => document.getElementById(id);
const rupees = (n) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clock = (d = new Date()) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = (ms) => new Promise((r) => setTimeout(r, reduceMotion ? 0 : ms));

function setChip(el, text, tone) {
  el.textContent = text;
  el.className = `chip chip-${tone}`;
}

function toast(message) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<svg><use href="#i-check"/></svg><span>${esc(message)}</span>`;
  $('toasts').appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 260); }, 2600);
}

/** Smoothly count a number to its new value. */
function countTo(el, to, format = (n) => String(Math.round(n))) {
  const from = Number(el.dataset.v || 0);
  el.dataset.v = String(to);
  if (reduceMotion || from === to) { el.textContent = format(to); return; }
  const start = performance.now();
  const duration = 800;
  const tick = (now) => {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = format(from + (to - from) * eased);
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/* ---------- derived numbers ---------- */
function totals() {
  const risk = cases.reduce((a, c) => a + c.amount, 0);
  const recovered = cases.filter((c) => c.outcome === 'recovered').reduce((a, c) => a + c.amount, 0);
  const eligible = cases.filter((c) => c.status === 'approve');
  const pending = eligible.filter((c) => !c.outcome);
  const eligibleValue = eligible.reduce((a, c) => a + c.amount, 0);
  const avg = eligible.length ? Math.round(eligible.reduce((a, c) => a + c.confidence, 0) / eligible.length) : 0;
  return { risk, recovered, eligible, pending, eligibleValue, avg, done: cases.filter((c) => c.outcome === 'recovered').length };
}

/* ---------- renderers ---------- */
function renderMetrics() {
  const t = totals();
  countTo($('atRisk'), t.risk, rupees);
  countTo($('recovered'), t.recovered, rupees);
  countTo($('gated'), t.pending.length);
  countTo($('confidence'), t.avg, (n) => `${Math.round(n)}%`);
  $('batchInfo').textContent = `across ${cases.length} payment events`;
  $('recoveryRate').textContent = `${t.eligibleValue ? Math.round((t.recovered / t.eligibleValue) * 100) : 0}%`;
  $('queueBadge').textContent = t.pending.length;
  $('riskBar').style.width = `${t.risk ? Math.round((t.eligibleValue / t.risk) * 100) : 0}%`;
  $('recBar').style.width = `${t.risk ? Math.round((t.recovered / t.risk) * 100) : 0}%`;
  $('confBar').style.width = `${t.avg}%`;
  $('gateDots').innerHTML = t.pending.map((_, i) => `<i style="animation-delay:${i * 60}ms"></i>`).join('');
  $('detected').textContent = cases.length;
  $('diagnosed').textContent = swept ? cases.length : 0;
  $('bounded').textContent = swept ? t.eligible.length : 0;
  $('recoveredCount').textContent = t.done;
}

function confidenceMeter(c) {
  const tone = c.confidence >= 85 ? 'var(--green)' : c.confidence >= 70 ? 'var(--amber)' : 'var(--red)';
  return `<div class="meter"><i style="--w:${c.confidence}%;--c:${tone}"></i><span>${c.confidence}%</span></div>`;
}

function renderCases() {
  const shown = cases.filter((c) => filter === 'all' || c.status === filter);
  if (!shown.length) { $('caseRows').innerHTML = '<tr><td colspan="7" class="empty">No cases in this view.</td></tr>'; return; }
  $('caseRows').innerHTML = shown.map((c, i) => {
    const done = c.outcome === 'recovered';
    return `<tr style="animation-delay:${i * 50}ms">
      <td><span class="customer">${esc(c.customer)}</span><span class="payment">${esc(c.id)}</span></td>
      <td class="amount">${rupees(c.amount)}</td>
      <td><span class="cause">${esc(c.cause)}</span></td>
      <td>${confidenceMeter(c)}</td>
      <td><span class="action">${done ? 'Recovered ✓' : esc(c.action)}</span></td>
      <td><span class="pill ${done ? 'done' : c.status}">${done ? 'COMPLETED' : c.status === 'approve' ? 'APPROVAL REQUIRED' : 'HELD BY POLICY'}</span></td>
      <td><div class="row-actions"><button class="mini" data-details="${esc(c.id)}">Case file</button>${c.status === 'approve' && !c.outcome ? `<button class="mini go" data-case="${esc(c.id)}">Review</button>` : ''}</div></td>
    </tr>`;
  }).join('');
}

function renderAudit() {
  const local = audit.map((a) => `<div class="audit-item"><div><strong>${esc(a.title)}</strong><p>${esc(a.detail)}</p></div><time>${esc(a.time)}</time></div>`);
  const remote = serverState.audit.slice(0, 20).map((a) => `<div class="audit-item" style="border-left-color:var(--blue)"><div><strong>${esc(a.title)}</strong><p>${esc(a.detail)} <span class="mono" style="color:var(--faint)">#${esc(String(a.integrity_hash || '').slice(0, 10))}</span></p></div><time>${esc(clock(new Date(a.at)))}</time></div>`);
  const rows = [...local, ...remote];
  $('auditLog').innerHTML = rows.length ? rows.join('') : '<p class="empty">No sweep has been run. Every decision will appear here with its evidence, policy status and outcome.</p>';
}

function renderDrivers() {
  const byDriver = new Map();
  cases.forEach((c) => byDriver.set(c.driver, (byDriver.get(c.driver) || 0) + c.amount));
  const ranked = [...byDriver.entries()].sort((a, b) => b[1] - a[1]);
  const max = ranked[0][1];
  $('topDriver').textContent = ranked[0][0];
  const share = Math.round((ranked[0][1] / cases.reduce((a, c) => a + c.amount, 0)) * 100);
  $('driverText').textContent = `${ranked[0][0]} accounts for ${share}% of the value at risk in this batch. RecoverFlow only recommends actions the evidence and policy support.`;
  $('driverBars').innerHTML = ranked.map(([name, value], i) => `<div class="driver ${i === 0 ? 'top' : ''}" style="animation-delay:${i * 70}ms"><div class="driver-top"><span>${esc(name)}</span><b>${rupees(value)}</b></div><div class="driver-track"><i data-w="${Math.round((value / max) * 100)}"></i></div></div>`).join('');
  requestAnimationFrame(() => requestAnimationFrame(() => document.querySelectorAll('.driver-track i').forEach((el) => { el.style.width = `${el.dataset.w}%`; })));
  const covered = cases.filter((c) => c.evidence).length;
  $('evidenceCoverage').textContent = `${Math.round((covered / cases.length) * 100)}%`;
}

function resetDrivers() {
  $('topDriver').textContent = 'Run a sweep';
  $('driverText').textContent = 'Run a sweep to rank what is costing you the most, by value at risk.';
  $('driverBars').innerHTML = '';
  $('evidenceCoverage').textContent = '0%';
}

function renderAll() { renderMetrics(); renderCases(); renderAudit(); }

/* ---------- sweep ---------- */
/** When the API is running, let the real diagnosis + policy engine classify each case. */
async function classifyWithEngine() {
  if (!serverState.online) return false;
  try {
    const results = await Promise.all(cases.map(async (c) => {
      const res = await fetch('/api/diagnose', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(caseEvent(c)) });
      if (!res.ok) throw new Error('engine unavailable');
      return res.json();
    }));
    results.forEach((r, i) => {
      const c = cases[i];
      c.confidence = Math.round(r.diagnosis.confidence * 100);
      c.status = r.decision.status === 'approval_required' ? 'approve' : 'hold';
      c.policy = r.decision.policy_code;
      c.engineReason = r.decision.reason;
      c.action = c.status === 'approve' ? (r.diagnosis.recommended_action || c.action) : `Hold — ${r.decision.reason}`;
    });
    return true;
  } catch { return false; }
}

async function sweep() {
  const btn = $('runButton');
  if (btn.disabled) return;
  btn.disabled = true;
  swept = false;
  audit = [];
  setChip($('engineState'), 'RUNNING', 'warn');
  $('flowTag').textContent = 'Running';
  $('flowTag').classList.add('on');
  const nodes = [...document.querySelectorAll('.node')];
  const links = [...document.querySelectorAll('.link')];
  nodes.forEach((n) => n.classList.remove('lit'));
  const live = await classifyWithEngine();
  renderCases();
  const t = totals();
  const stepCounts = [cases.length, cases.length, t.eligible.length, t.done];
  const stepIds = ['detected', 'diagnosed', 'bounded', 'recoveredCount'];
  for (let i = 0; i < nodes.length; i += 1) {
    nodes[i].classList.add('lit');
    countTo($(stepIds[i]), stepCounts[i]);
    if (links[i]) { links[i].classList.remove('run'); void links[i].offsetWidth; links[i].classList.add('run'); }
    await wait(480);
  }
  swept = true;
  cases.forEach((c) => audit.push({
    title: `Diagnosed ${c.id}: ${c.cause}`,
    detail: `Evidence: ${c.evidence}. Policy outcome: ${c.status === 'approve' ? 'eligible for human approval' : 'held; no money action permitted'}${c.policy ? ` (${c.policy})` : ''}.${live ? ' Classified by the live engine.' : ''}`,
    time: clock(),
  }));
  setChip($('engineState'), 'SWEEP COMPLETE', 'ok');
  $('flowTag').textContent = 'Complete';
  renderDrivers();
  renderAll();
  btn.disabled = false;
  toast(`Sweep complete · ${t.eligible.length} eligible, ${cases.length - t.eligible.length} held${live ? ' · live engine' : ''}`);
  refreshServer();
}

function resetDemo() {
  cases = structuredClone(seedCases);
  audit = [];
  swept = false;
  document.querySelectorAll('.node').forEach((n) => n.classList.remove('lit'));
  setChip($('engineState'), 'READY', 'idle');
  $('flowTag').textContent = 'Idle';
  $('flowTag').classList.remove('on');
  resetDrivers();
  renderAll();
  toast('Demo reset');
}

/* ---------- dialogs ---------- */
function openApproval(id) {
  activeCase = cases.find((c) => c.id === id);
  if (!activeCase) return;
  $('approvalContent').innerHTML = `<div class="dialog-case"><strong>${esc(activeCase.customer)} · ${rupees(activeCase.amount)}</strong><br>${esc(activeCase.action)}<br><br><span class="eyebrow" style="margin:0">Evidence</span>${esc(activeCase.evidence)}<br><br><span class="eyebrow" style="margin:0">Boundary</span>One action only. Automatic retries and further customer contact stay disabled.</div>`;
  $('approvalDialog').showModal();
}

function caseEvent(c) {
  const lookup = { 'Bank timeout after OTP': 'issuer network timeout', 'Insufficient balance': 'insufficient balance', 'Invoice overdue, 14 days': 'insufficient balance', 'Checkout abandonment': 'checkout abandoned', 'Repeated mandate failure': 'mandate expired', 'Possible duplicate charge': 'duplicate payment' };
  return {
    id: c.id,
    amount: c.amount * 100,
    error_description: lookup[c.cause] || 'unclassified error',
    customer_opted_in: c.status === 'approve',
    retry_count: c.cause === 'Repeated mandate failure' ? 1 : 0,
    duplicate_suspected: c.cause === 'Possible duplicate charge',
    checkout_open_minutes: c.cause === 'Checkout abandonment' ? 8 : 0,
  };
}

function openCaseFile(id) {
  const c = cases.find((x) => x.id === id);
  if (!c) return;
  const done = c.outcome === 'recovered';
  const policy = done ? 'Approved and completed' : c.status === 'approve' ? 'Human approval required' : 'Hard stop — no action';
  const drafting = c.status === 'approve'
    ? '<div class="case-field"><span>Consent-safe message draft</span><b>Preview only. Nothing is sent.</b><div class="message-tools"><button type="button" class="mini" data-language="en">Draft English</button><button type="button" class="mini" data-language="hinglish">Draft Hinglish</button></div><div class="message-output" id="messageOutput"></div></div>'
    : '';
  $('caseTitle').textContent = `${c.customer} · ${c.id}`;
  $('caseContent').innerHTML = `
    <div class="case-summary"><div><strong>${esc(c.cause)}</strong><small>AI confidence · ${c.confidence}%</small></div><span class="case-amount">${rupees(c.amount)}</span></div>
    <div class="case-grid"><div class="case-field"><span>Recommended action</span><b>${done ? 'Recovered ✓' : esc(c.action)}</b></div><div class="case-field"><span>Policy decision</span><b>${esc(policy)}</b></div></div>
    <div class="case-field"><span>Evidence used</span><ul class="evidence-list">${c.evidence.split(' · ').map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>
    ${drafting}
    <div class="timeline"><h3>Recovery timeline</h3>
      <div class="timeline-item"><span>T+00:00</span>Payment event entered the recovery queue.</div>
      <div class="timeline-item"><span>T+00:01</span>Diagnosis completed: ${esc(c.cause)}.</div>
      <div class="timeline-item"><span>T+00:01</span>${c.status === 'approve' ? 'Policy allowed one bounded action and requested human approval.' : 'Policy stopped the workflow and kept the exception visible.'}</div>
      ${done ? '<div class="timeline-item"><span>T+00:03</span>Human approval recorded; outcome measured as recovered in this demo.</div>' : ''}
    </div>
    <div class="case-dialog-footer">${c.status === 'approve' && !done ? '<button type="button" class="btn btn-primary" id="reviewFromFile"><span class="btn-label">Review action</span><svg><use href="#i-arrow"/></svg></button>' : '<button value="cancel" class="btn btn-ghost">Close case file</button>'}</div>`;
  $('caseDialog').showModal();
  const review = $('reviewFromFile');
  if (review) review.onclick = () => { $('caseDialog').close(); openApproval(c.id); };
  document.querySelectorAll('[data-language]').forEach((b) => { b.onclick = () => draftMessage(c, b.dataset.language); });
}

async function draftMessage(c, language) {
  const out = $('messageOutput');
  out.classList.add('visible');
  out.textContent = 'Creating policy-safe preview…';
  try {
    const res = await fetch('/api/draft-message', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ event: caseEvent(c), language }) });
    const data = await res.json();
    if (!res.ok) { out.innerHTML = `<strong>Blocked by policy.</strong> ${esc(data.reason || 'Draft unavailable')}`; return; }
    out.innerHTML = `${esc(data.message.replace('[PAYMENT_LINK]', '[secure payment link]'))}<small>Draft only. Human approval and an explicit send step are still required.</small>`;
  } catch {
    out.innerHTML = 'Start RecoverFlow with <code>npm run dev</code> to generate the server-validated message preview.';
  }
}

$('approvalDialog').addEventListener('close', () => {
  if ($('approvalDialog').returnValue === 'approve' && activeCase) {
    activeCase.outcome = 'recovered';
    audit.unshift({ title: `Approved and recovered ${activeCase.id}`, detail: `Human approved “${activeCase.action}”. Outcome recorded as recovered for this demo simulation. Evidence and policy boundary retained.`, time: clock() });
    renderAll();
    if (swept) $('recoveredCount').textContent = totals().done;
    toast(`${activeCase.customer}: ${rupees(activeCase.amount)} recovered`);
  }
  activeCase = null;
});

/* ---------- decision lab ---------- */
function highlightJson(obj) {
  return esc(JSON.stringify(obj, null, 2)).replace(/(&quot;[^&]*?&quot;)(\s*:)?|\b(-?\d+(?:\.\d+)?)\b|\b(true|false|null)\b/g, (m, str, colon, num, lit) => {
    if (str) return colon ? `<span class="j-k">${str}</span>${colon}` : `<span class="j-s">${str}</span>`;
    return `<span class="j-n">${num || lit}</span>`;
  });
}

function loadScenario() { $('eventJson').value = JSON.stringify(labScenarios[$('scenarioSelect').value], null, 2); }

async function evaluateLab() {
  const btn = $('evaluateButton');
  const result = $('decisionResult');
  let event;
  try { event = JSON.parse($('eventJson').value); } catch { result.innerHTML = '<span class="verdict hold">INVALID JSON</span><br>Fix the event JSON and try again.'; return; }
  btn.disabled = true;
  btn.querySelector('.btn-label').textContent = 'Evaluating…';
  result.innerHTML = '<span class="muted">Evaluating evidence and policy…</span>';
  try {
    const res = await fetch('/api/diagnose', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(event) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'service unavailable');
    const pct = Math.round(data.diagnosis.confidence * 100);
    const allowed = data.decision.status === 'approval_required';
    result.innerHTML = `<span class="verdict ${allowed ? 'ok' : 'hold'}">${allowed ? 'APPROVAL REQUIRED' : 'HELD BY POLICY'} · ${esc(data.decision.policy_code)}</span><br>Diagnosis: <strong>${esc(data.diagnosis.label.replaceAll('_', ' '))}</strong> (${pct}% confidence). ${esc(allowed ? data.diagnosis.recommended_action : data.decision.reason)}<pre>${highlightJson(data)}</pre>`;
    refreshServer();
  } catch {
    result.innerHTML = '<span class="verdict hold">SERVICE OFFLINE</span><br>Start RecoverFlow with <code>npm run dev</code> to use the live decision service.';
  } finally {
    btn.disabled = false;
    btn.querySelector('.btn-label').textContent = 'Evaluate event';
  }
}

/* ---------- simulator (illustrative model) ---------- */
function simulateBatch() {
  const volume = Number($('volumeSelect').value);
  const avg = 8600, recoverable = 0.72;
  const atRisk = volume * avg;
  const genericRecovered = Math.round(atRisk * recoverable * 0.31);
  const rfRecovered = Math.round(atRisk * recoverable * 0.52);
  const waste = Math.round(volume * 0.28), protectedCases = Math.round(volume * 0.28);
  const genericReviews = Math.round(volume * 0.64), rfReviews = Math.round(volume * 0.37);
  $('genericRecovered').textContent = rupees(genericRecovered);
  $('genericWaste').textContent = `${waste} actions`;
  $('genericReviews').textContent = `${genericReviews} cases`;
  $('rfRecovered').textContent = rupees(rfRecovered);
  $('rfProtected').textContent = `${protectedCases} cases`;
  $('rfReviews').textContent = `${rfReviews} cases`;
  $('genericBar').style.width = `${Math.round((genericRecovered / rfRecovered) * 100)}%`;
  $('rfBar').style.width = '100%';
  $('simInsight').innerHTML = `<strong>Scenario result:</strong> RecoverFlow recovers <strong>${rupees(rfRecovered - genericRecovered)}</strong> more from this ${volume}-event synthetic batch while holding ${protectedCases} unsafe or low-signal cases. Assumptions: ₹${avg.toLocaleString('en-IN')} average at-risk value, ${Math.round(recoverable * 100)}% recoverable events, one action per customer. This is a reproducible demo model, not a live merchant performance claim.`;
}

/* ---------- server state ---------- */
async function refreshServer() {
  try {
    const res = await fetch('/api/audit', { cache: 'no-store' });
    if (!res.ok) throw new Error('bad status');
    const data = await res.json();
    serverState = { online: true, events: data.events || [], audit: data.audit || [], integrity: data.integrity };
  } catch {
    serverState = { online: false, events: [], audit: [], integrity: null };
  }
  renderServer();
  renderAudit();
}

function renderServer() {
  const { online, events, audit: chain, integrity } = serverState;
  setChip($('serverState'), online ? 'ONLINE' : 'OFFLINE DEMO', online ? 'ok' : 'warn');
  if (!online) { setChip($('chainState'), 'N/A', 'idle'); setChip($('auditChain'), 'Local session', 'idle'); }
  else if (!chain.length) { setChip($('chainState'), 'EMPTY', 'idle'); setChip($('auditChain'), 'Chain ready', 'idle'); }
  else { const ok = integrity && integrity.valid; setChip($('chainState'), ok ? `VERIFIED · ${chain.length}` : 'BROKEN', ok ? 'ok' : 'bad'); setChip($('auditChain'), ok ? `Hash chain verified · ${chain.length}` : 'Chain broken', ok ? 'ok' : 'bad'); }
  $('navLive').hidden = !events.length;
  $('feedTag').textContent = events.length ? `${events.length} received` : online ? 'Listening' : 'Offline';
  $('feedTag').classList.toggle('on', events.length > 0);
  $('feed').innerHTML = events.length
    ? events.slice(0, 12).map((e) => {
      const allowed = e.decision && e.decision.status === 'approval_required';
      return `<div class="feed-item"><span class="pill ${allowed ? 'approve' : 'hold'}">${allowed ? 'APPROVAL' : 'HELD'}</span><div><b>${esc(e.id)} · ${rupees((e.amount || 0) / 100)}</b><p>${esc(String(e.diagnosis?.label || '').replaceAll('_', ' '))} · ${esc(e.decision?.policy_code || '')}</p></div><time>${esc(clock(new Date(e.received_at)))}</time></div>`;
    }).join('')
    : '<p class="empty">No webhook events yet. When one arrives it is verified, diagnosed, policy-checked and shown here.</p>';
}

/* ---------- wiring ---------- */
function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  try { localStorage.setItem('rf-theme', theme); } catch { /* storage blocked */ }
  document.querySelector('meta[name="theme-color"]').setAttribute('content', theme === 'dark' ? '#07100c' : '#f3f6f1');
}
const toggleTheme = () => setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');

$('runButton').onclick = sweep;
$('resetButton').onclick = resetDemo;
$('themeToggle').onclick = toggleTheme;
$('scenarioSelect').onchange = loadScenario;
$('evaluateButton').onclick = evaluateLab;
$('simulateButton').onclick = simulateBatch;
$('copyEndpoint').onclick = async () => { try { await navigator.clipboard.writeText($('endpointUrl').textContent); toast('Webhook URL copied'); } catch { toast('Select the URL and copy it'); } };

document.querySelectorAll('.seg-btn').forEach((b) => b.addEventListener('click', () => {
  filter = b.dataset.filter;
  document.querySelectorAll('.seg-btn').forEach((x) => { const on = x === b; x.classList.toggle('is-on', on); x.setAttribute('aria-selected', String(on)); });
  renderCases();
}));

$('caseRows').addEventListener('click', (e) => {
  const review = e.target.closest('[data-case]');
  const details = e.target.closest('[data-details]');
  if (review) openApproval(review.dataset.case);
  else if (details) openCaseFile(details.dataset.details);
});

$('downloadButton').onclick = () => {
  const blob = new Blob([JSON.stringify({ generatedAt: new Date().toISOString(), cases, audit, serverAudit: serverState.audit, policy: 'One action per 24h; explicit approval required; contact opt-outs enforced.' }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'recoverflow-audit.json';
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Audit exported');
};

const sidebar = $('sidebar');
const closeMenu = () => { sidebar.classList.remove('open'); $('scrim').hidden = true; $('menuBtn').setAttribute('aria-expanded', 'false'); };
$('menuBtn').onclick = () => { const open = sidebar.classList.toggle('open'); $('scrim').hidden = !open; $('menuBtn').setAttribute('aria-expanded', String(open)); };
$('scrim').onclick = closeMenu;
sidebar.addEventListener('click', (e) => { if (e.target.closest('a')) closeMenu(); });

document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) || document.querySelector('dialog[open]')) return;
  if (e.key === 'r' || e.key === 'R') sweep();
  if (e.key === 't' || e.key === 'T') toggleTheme();
});

// Scroll reveal + active nav
const revealTargets = document.querySelectorAll('.kpis, .grid-2 > *, .queue, .live, .lab, .sim, .audit, .policy, .footer');
if ('IntersectionObserver' in window && !reduceMotion) {
  const io = new IntersectionObserver((entries) => entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } }), { threshold: 0.08 });
  revealTargets.forEach((el) => { el.classList.add('reveal'); io.observe(el); });
  const navLinks = [...document.querySelectorAll('[data-nav]')];
  const spy = new IntersectionObserver((entries) => entries.forEach((en) => {
    if (en.isIntersecting) navLinks.forEach((a) => a.classList.toggle('active', a.dataset.nav === en.target.id));
  }), { rootMargin: '-35% 0px -55% 0px' });
  ['overview', 'cases', 'live', 'lab', 'audit', 'policy'].forEach((id) => { const el = $(id); if (el) spy.observe(el); });
}

$('year').textContent = new Date().getFullYear();
$('endpointUrl').textContent = `${location.origin}/webhooks/razorpay`;
loadScenario();
renderAll();
refreshServer();
setInterval(() => { if (!document.hidden) refreshServer(); }, 6000);
