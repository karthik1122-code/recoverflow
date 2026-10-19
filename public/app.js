import { announce, chime } from './sound.js';
// RecoverFlow dashboard. Plain DOM, no framework. All server text goes through esc().
const $ = id => document.getElementById(id);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const rupees = paise => inr.format(Math.round((Number(paise) || 0) / 100));
const pct = x => `${Math.round((Number(x) || 0) * 100)}%`;
const dateFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' });
const when = iso => { const t = Date.parse(iso); return Number.isFinite(t) ? dateFmt.format(t) : ''; };
const ago = iso => {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (!Number.isFinite(s)) return '';
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
};
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? '⌘K' : 'Ctrl K';
$('modKey').textContent = MOD;
document.querySelectorAll('[data-mod]').forEach(n => { n.textContent = MOD; });

const REASON = {
  transient_bank_failure: 'Bank timed out',
  insufficient_funds: 'Not enough balance',
  mandate_or_card_issue: 'Card or mandate needs updating',
  high_intent_abandonment: 'Left at checkout',
  possible_duplicate: 'Might be a duplicate charge',
  dispute_risk: 'Customer has a dispute open',
  retry_limit_reached: 'Already followed up today',
  unknown: 'Reason unclear',
};
const STATUS = { open: 'Needs approval', approving: 'Sending link', link_sent: 'Waiting for payment', recovered: 'Recovered', held: 'Held by safety rules', expired: 'Link expired', dismissed: 'Closed' };
const POLICY = {
  HUMAN_GATE: ['Safe to follow up', 'One payment link is allowed once you approve it.'],
  NO_CONSENT: ['Customer has not agreed to be contacted', 'RecoverFlow never messages someone without consent.'],
  HIGH_VALUE_REVIEW: ['Over ₹5,00,000', 'Large amounts go to your accounts owner instead.'],
  EXCEPTION_QUEUE: ['Never followed up automatically', 'Duplicates, disputes and unclear failures need a person to look first.'],
  LOW_CONFIDENCE: ['Not sure enough about the reason', 'Below the 75% confidence the rules require.'],
};
const VIEWS = {
  inbox: { title: 'Needs approval', match: s => s === 'open' || s === 'approving', select: true },
  sent: { title: 'Waiting for payment', match: s => s === 'link_sent' },
  recovered: { title: 'Recovered', match: s => s === 'recovered' },
  held: { title: 'Held by safety rules', match: s => s === 'held' },
  all: { title: 'All cases', match: () => true },
};
const EMPTY = {
  inbox: ['You are all caught up', 'New failed payments appear here within seconds of Razorpay sending them.'],
  sent: ['No links are out', 'Approve a case to send its payment link.'],
  recovered: ['Nothing has come back yet', 'When a customer pays through a link, the case lands here with the amount.'],
  held: ['Nothing is held', 'Duplicates, disputes and customers without consent would appear here.'],
  all: ['No failed payments yet', 'Connect Razorpay, or send a test failure to see how a case looks.'],
};
const AVATAR = ['#fde3ad', '#cdeedd', '#e0d8fb', '#fbd9d6', '#d6e4fb', '#f6dcc0'];
const avatarFor = name => { let h = 0; for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return AVATAR[h % AVATAR.length]; };
const initials = name => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');

const state = { cases: [], summary: null, razorpay: {}, connect: null, report14: null, me: {}, view: 'inbox', q: '', reason: null, openId: null, mode: null, cursor: -1, selected: new Set(), list: [], prev: null, reportDays: 7, firstLoad: true, fresh: new Set() };
const statusOf = c => c.recovery?.status || 'open';
const byId = id => state.cases.find(c => c.id === id);
const nameOf = c => c.customer?.name || c.customer?.email || 'Unknown customer';

async function api(path, body) {
  const res = await fetch(path, body === undefined ? { cache: 'no-store' } : { method: 'POST', body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.message || readableError(data.error) || `Request failed (${res.status})`); e.status = res.status; e.data = data; throw e; }
  return data;
}
function readableError(code) {
  return {
    forbidden: 'Your role cannot do this. Ask an admin to make you an approver.',
    invalid_transition: 'Someone else already acted on this case. It has been refreshed.',
    razorpay_not_configured: 'Add your Razorpay API keys on the Connect page first.',
    webhook_secret_missing: 'Set the webhook secret first. See the Connect page.',
  }[code];
}

let toastTimer;
function toast(msg, { wave = false } = {}) {
  const t = $('toast');
  t.innerHTML = `${wave ? '<span class="wave on" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>' : ''}<span>${esc(msg)}</span>`;
  t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3600);
}

/* ---------- announcements: the counter soundbox ---------- */
const announceBox = $('announce');
try { announceBox.checked = localStorage.getItem('rf-announce') === 'on'; } catch { /* storage blocked */ }
announceBox.addEventListener('change', () => {
  try { localStorage.setItem('rf-announce', announceBox.checked ? 'on' : 'off'); } catch { /* ignore */ }
  if (announceBox.checked) chime(); // the click is the gesture browsers need before any sound
});
function announceRecovered(c) {
  const amount = Math.round((c.recovery?.recovered_amount ?? c.amount) / 100);
  const first = nameOf(c).split(' ')[0];
  toast(`${inr.format(amount)} recovered from ${first}`, { wave: true });
  if (announceBox.checked) announce(amount, first);
}

/* ---------- data ---------- */
async function loadCases() {
  const data = await api('/api/cases');
  const before = new Map(state.cases.map(c => [c.id, statusOf(c)]));
  state.cases = data.cases;
  state.summary = data.summary;
  state.razorpay = data.razorpay;
  state.fresh = state.firstLoad ? new Set() : new Set(data.cases.filter(c => !before.has(c.id)).map(c => c.id));
  if (!state.firstLoad) for (const c of data.cases) if (statusOf(c) === 'recovered' && before.has(c.id) && before.get(c.id) !== 'recovered') announceRecovered(c);
  for (const id of [...state.selected]) if (statusOf(byId(id) || {}) !== 'open') state.selected.delete(id);
  state.firstLoad = false;
  renderCounts();
  if (VIEWS[state.view]) renderCases();
  if (state.openId) { const c = byId(state.openId); if (c) renderDrawer(c); }
}
async function loadTrend() {
  state.report14 = await api('/api/report?days=14');
  renderMoney();
}

function renderCounts() {
  const by = state.summary?.by_status || {};
  const set = (k, n) => { const el = document.querySelector(`[data-count="${k}"]`); if (el) el.textContent = n ? n : ''; };
  set('open', (by.open || 0) + (by.approving || 0));
  set('sent', by.link_sent || 0);
  set('recovered', by.recovered || 0);
  set('held', by.held || 0);
}

function renderMoney() {
  const r = state.report14; if (!r) return;
  $('mBack').textContent = rupees(r.recovered_amount);
  $('mSub').textContent = r.links_sent ? `${r.recovered_count} of ${r.links_sent} links sent were paid. ${rupees(r.failed_amount)} failed in the same days.` : 'Nothing has been sent yet in this period.';
  const today = new Date().toISOString().slice(0, 10);
  // Today is still open, so one big failure can dwarf two weeks. Scale to the finished days and let today clip at the top.
  const past = r.daily.filter(d => d.date !== today).map(d => d.failed);
  const max = Math.max(1, ...(past.some(Boolean) ? past : r.daily.map(d => d.failed))) * 1.1;
  $('spark').innerHTML = r.daily.map(d => {
    const label = dayFmt.format(Date.parse(d.date));
    return `<div class="c${d.date === today ? ' today' : ''}" data-tip="${esc(label)}: ${esc(rupees(d.failed))} failed, ${esc(rupees(d.recovered))} back"><div class="bar" style="height:${d.failed ? Math.min(100, Math.max(4, (d.failed / max) * 100)) : 2}%"><div class="in" style="height:${d.failed ? Math.min(100, (d.recovered / d.failed) * 100) : 0}%"></div></div></div>`;
  }).join('');
  $('spark').setAttribute('aria-label', `Daily failed and recovered money for the last 14 days. ${rupees(r.recovered_amount)} recovered in total.`);
}

/* ---------- list ---------- */
function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning.' : h < 17 ? 'Good afternoon.' : 'Good evening.';
}
function subFor(view, list) {
  const total = list.reduce((s, c) => s + (statusOf(c) === 'recovered' ? (c.recovery?.recovered_amount ?? c.amount) : c.amount), 0);
  const n = list.length, people = n === 1 ? 'customer' : 'customers';
  if (view === 'inbox') {
    if (!n) return 'Nothing needs you right now.';
    const top = Object.entries(list.reduce((m, c) => { const k = c.diagnosis?.label || 'unknown'; m[k] = (m[k] || 0) + c.amount; return m; }, {})).sort((a, b) => b[1] - a[1])[0];
    return `<b>${esc(rupees(total))}</b> from ${n} ${people} can still pay you. Most of it failed because: ${esc((REASON[top[0]] || REASON.unknown).toLowerCase())}. Nothing is sent until you approve.`;
  }
  if (view === 'sent') return n ? `${n} ${n === 1 ? 'link is' : 'links are'} out, worth <b>${esc(rupees(total))}</b>. Cases close by themselves when customers pay.` : 'No links are out right now.';
  if (view === 'recovered') return n ? `<b>${esc(rupees(total))}</b> came back from ${n} ${people}.` : 'Nothing has come back yet.';
  if (view === 'held') return n ? `${n} ${n === 1 ? 'failure' : 'failures'} RecoverFlow will not follow up. Look at them, then close them.` : 'Nothing is held.';
  return 'Every failed payment RecoverFlow has received.';
}

function renderCases() {
  const v = VIEWS[state.view];
  const inView = state.cases.filter(c => v.match(statusOf(c)));
  $('casesTitle').textContent = state.view === 'inbox' ? greeting() : v.title;
  $('casesSub').innerHTML = subFor(state.view, inView);
  document.title = `${v.title} · RecoverFlow`;

  // reason chips for this view
  const counts = inView.reduce((m, c) => { const k = c.diagnosis?.label || 'unknown'; m[k] = (m[k] || 0) + 1; return m; }, {});
  if (state.reason && !counts[state.reason]) state.reason = null;
  const keys = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  $('chips').innerHTML = keys.length > 1 ? [`<button type="button" data-reason="" aria-pressed="${!state.reason}">All <small>${inView.length}</small></button>`]
    .concat(keys.map(k => `<button type="button" data-reason="${esc(k)}" aria-pressed="${state.reason === k}">${esc(REASON[k] || k)} <small>${counts[k]}</small></button>`)).join('') : '';

  const q = state.q.trim().toLowerCase();
  const list = inView
    .filter(c => !state.reason || c.diagnosis?.label === state.reason)
    .filter(c => !q || [nameOf(c), c.id, REASON[c.diagnosis?.label], c.customer?.email].some(x => String(x || '').toLowerCase().includes(q)));
  state.list = list;
  if (state.cursor >= list.length) state.cursor = list.length - 1;

  const selectable = !!v.select;
  $('casesTable').classList.toggle('no-sel', !selectable);
  $('rows').innerHTML = list.map((c, i) => {
    const s = statusOf(c), name = nameOf(c);
    const amount = s === 'recovered' ? (c.recovery?.recovered_amount ?? c.amount) : c.amount;
    const canSel = selectable && s === 'open';
    return `<tr data-id="${esc(c.id)}" data-i="${i}" class="${state.fresh.has(c.id) ? 'is-new' : ''}${state.selected.has(c.id) ? ' is-sel' : ''}${i === state.cursor ? ' cursor' : ''}">
      <td class="sel">${canSel ? `<input type="checkbox" data-sel="${esc(c.id)}" ${state.selected.has(c.id) ? 'checked' : ''} aria-label="Select ${esc(name)}">` : ''}</td>
      <td><div class="cust"><span class="avatar" style="background:${avatarFor(name)}" aria-hidden="true">${esc(initials(name))}</span><span class="cust-t"><b>${esc(name)}${c.test_event ? '<span class="tag">Test</span>' : ''}</b><small>${esc(c.customer?.contact || c.customer?.email || c.id)}</small></span></div></td>
      <td class="num">${rupees(amount)}</td>
      <td class="reason">${esc(REASON[c.diagnosis?.label] || REASON.unknown)}</td>
      <td class="st"><span class="chip" data-s="${s}">${esc(STATUS[s] || s)}</span></td>
      <td class="when"><time datetime="${esc(c.received_at)}" title="${esc(when(c.received_at))}">${esc(ago(c.received_at))}</time></td>
      <td class="act">${s === 'open' ? `<button class="btn btn-sm row-act" type="button" data-quick="${esc(c.id)}">Send link</button>` : ''}</td>
    </tr>`;
  }).join('');

  const empty = $('empty');
  if (!list.length) {
    const [h, p] = q || state.reason ? ['No matches', 'Nothing in this list matches. Clear the search or the filter.'] : EMPTY[state.view];
    empty.innerHTML = `<h3>${esc(h)}</h3><p>${esc(p)}</p>${!q && state.view === 'all' ? '<a class="btn btn-ink" href="#connect">Connect Razorpay</a>' : ''}`;
    empty.hidden = false; $('casesTable').hidden = true;
  } else { empty.hidden = true; $('casesTable').hidden = false; }
  const openOnes = list.filter(c => statusOf(c) === 'open');
  $('selAll').checked = openOnes.length > 0 && openOnes.every(c => state.selected.has(c.id));
  $('selAll').indeterminate = !$('selAll').checked && openOnes.some(c => state.selected.has(c.id));
  $('tableFoot').innerHTML = list.length ? `${list.length} ${list.length === 1 ? 'case' : 'cases'}. Press <span class="kbd">?</span> for keyboard shortcuts.` : '';
  renderBulk();
}

$('chips').addEventListener('click', e => { const b = e.target.closest('[data-reason]'); if (!b) return; state.reason = b.dataset.reason || null; state.cursor = -1; renderCases(); });
$('search').addEventListener('input', e => { state.q = e.target.value; state.cursor = -1; renderCases(); });
$('rows').addEventListener('click', e => {
  const sel = e.target.closest('[data-sel]');
  if (sel) { toggleSel(sel.dataset.sel); return; }
  const quick = e.target.closest('[data-quick]');
  if (quick) { openCase(quick.dataset.quick, { confirm: true }); return; }
  if (e.target.closest('.sel')) return;
  const tr = e.target.closest('tr[data-id]'); if (tr) openCase(tr.dataset.id);
});
$('selAll').addEventListener('change', e => {
  for (const c of state.list.filter(c => statusOf(c) === 'open')) { if (e.target.checked) state.selected.add(c.id); else state.selected.delete(c.id); }
  renderCases();
});
function toggleSel(id) {
  if (statusOf(byId(id) || {}) !== 'open') return;
  if (state.selected.has(id)) state.selected.delete(id); else state.selected.add(id);
  renderCases();
}

/* ---------- bulk ---------- */
let bulkConfirm = false;
function renderBulk() {
  const ids = [...state.selected].filter(id => byId(id));
  if (!ids.length || !VIEWS[state.view]?.select) { $('bulk').hidden = true; bulkConfirm = false; return; }
  const total = ids.reduce((s, id) => s + byId(id).amount, 0);
  $('bulk').hidden = false;
  $('bulkText').innerHTML = bulkConfirm ? `Send ${ids.length} payment ${ids.length === 1 ? 'link' : 'links'} for <b>${esc(rupees(total))}</b>?` : `${ids.length} selected, <b>${esc(rupees(total))}</b>`;
  $('bulkSend').textContent = bulkConfirm ? `Yes, send ${ids.length}` : `Send ${ids.length} ${ids.length === 1 ? 'link' : 'links'}`;
  $('bulkClear').textContent = bulkConfirm ? 'Cancel' : 'Clear';
}
$('bulkClear').addEventListener('click', () => { if (bulkConfirm) bulkConfirm = false; else state.selected.clear(); renderCases(); });
$('bulkSend').addEventListener('click', async () => {
  if (!bulkConfirm) { bulkConfirm = true; renderBulk(); return; }
  const ids = [...state.selected]; let ok = 0, failed = 0;
  $('bulkSend').disabled = true;
  for (const [i, id] of ids.entries()) {
    $('bulkText').textContent = `Sending ${i + 1} of ${ids.length}…`;
    try { await api(`/api/cases/${encodeURIComponent(id)}/approve`, {}); ok += 1; } catch { failed += 1; }
  }
  $('bulkSend').disabled = false; bulkConfirm = false; state.selected.clear();
  await Promise.all([loadCases(), loadTrend()]);
  toast(failed ? `${ok} ${ok === 1 ? 'link' : 'links'} sent, ${failed} could not be sent` : `${ok} payment ${ok === 1 ? 'link' : 'links'} sent${state.razorpay?.mode === 'simulated' ? ' (simulated)' : ''}`);
});

/* ---------- drawer ---------- */
let returnFocus = null;
function openCase(id, { confirm = false } = {}) {
  const c = byId(id); if (!c) return;
  returnFocus = document.activeElement;
  state.openId = id;
  state.mode = confirm && statusOf(c) === 'open' ? 'confirm' : null;
  $('scrim').hidden = false; $('drawer').hidden = false;
  renderDrawer(c);
  ($('dFoot').querySelector('[data-act="approve"]') || $('dClose')).focus();
}
function closeCase() {
  state.openId = null; state.mode = null;
  $('scrim').hidden = true; $('drawer').hidden = true;
  if (returnFocus && document.contains(returnFocus)) returnFocus.focus();
}
$('dClose').addEventListener('click', closeCase);
$('scrim').addEventListener('click', closeCase);

const ICON_OK = '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="m6.5 10.2 2.3 2.3 4.7-4.9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_STOP = '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M6.5 10h7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
function stampFor(c, slam) {
  const s = statusOf(c);
  if (s === 'recovered') return `<span class="stamp is-back${slam ? ' slam' : ''}">Recovered<small>${esc(rupees(c.recovery?.recovered_amount ?? c.amount))}</small></span>`;
  if (s === 'held') return '<span class="stamp is-held">Held</span>';
  return '<span class="stamp">Failed</span>';
}

function renderDrawer(c, { slam = false } = {}) {
  const s = statusOf(c), name = nameOf(c);
  const policy = POLICY[c.decision?.policy_code] || [c.decision?.reason || 'Policy decision', ''];
  const ok = c.decision?.status === 'approval_required';
  const merchant = state.connect?.merchant_name || 'your store';
  $('dTitle').textContent = name;
  $('dSub').textContent = `${STATUS[s] || s}. Failed ${when(c.received_at)}.`;
  const contactLine = [c.customer?.contact, c.customer?.email].filter(Boolean).join(' and ') || 'no contact on file';
  const history = [{ to: 'received', at: c.received_at, label: `Payment failed: ${c.error_description || 'no reason given by the bank'}` }]
    .concat((c.recovery?.history || []).map(h => ({ to: h.to, at: h.at, label: {
      approving: `Approved by ${h.by || 'a teammate'}`, link_sent: 'Payment link sent', recovered: 'Customer paid', open: 'Link could not be created; nothing was sent', expired: 'Link expired unpaid', dismissed: `Closed by ${h.by || 'a teammate'}`,
    }[h.to] || h.to })));
  const link = c.recovery?.link;
  $('dBody').innerHTML = `
    <div class="receipt" aria-label="Failed payment receipt">
      <div class="r-row"><span>Razorpay</span><span>${esc(c.received_event || 'payment.failed')}</span></div>
      <hr>
      <div class="r-head"><div class="r-amount">${esc(rupees(c.amount))}</div><div>${stampFor(c, slam)}</div></div>
      <div class="r-row"><span>Payment</span><span>${esc(c.id)}</span></div>
      <div class="r-row"><span>Failed</span><span>${esc(when(c.received_at))}</span></div>
      <hr>
      <div>${esc(c.error_description || 'No reason given by the bank')}</div>
    </div>
    <section class="block">
      <h3>Why it failed</h3>
      <p class="lead">${esc(REASON[c.diagnosis?.label] || REASON.unknown)}</p>
      <p>${Math.round((c.diagnosis?.confidence || 0) * 100)}% sure, based on:</p>
      <ul class="evidence">${(c.diagnosis?.evidence || []).map(e => `<li>${esc(e)}</li>`).join('')}</ul>
    </section>
    <section class="block">
      <h3>Safety check</h3>
      <div class="verdict" data-ok="${ok}">${ok ? ICON_OK : ICON_STOP}<div><b>${esc(policy[0])}</b><span>${esc(policy[1] || c.decision?.reason || '')}</span></div></div>
    </section>
    ${ok && s !== 'dismissed' ? `<section class="block sms">
      <h3>${s === 'open' ? 'What the customer will get' : 'What the customer got'}</h3>
      <span class="sms-from">From your Razorpay account</span>
      <div class="sms-bubble">Payment request from ${esc(merchant)} for ${esc(rupees(c.amount))}. Pay securely: <a href="${esc(link?.short_url || '#')}" ${link ? 'target="_blank" rel="noopener"' : 'tabindex="-1" aria-disabled="true"'}>${esc(link?.short_url || 'rzp.io/…')}</a></div>
      <small>By SMS and email to ${esc(contactLine)}. Sent once, never repeated.</small>
    </section>` : ''}
    ${link ? `<section class="block"><h3>Payment link</h3><div class="linkbox"><span>${esc(link.short_url)}</span><button class="btn btn-sm" type="button" data-copy="${esc(link.short_url)}">Copy</button></div></section>` : ''}
    <section class="block">
      <h3>History</h3>
      <ol class="timeline">${history.map(h => `<li data-to="${esc(h.to)}">${esc(h.label)}<time datetime="${esc(h.at)}">${esc(when(h.at))}</time></li>`).join('')}</ol>
    </section>
    ${c.recovery?.last_error && s === 'open' ? `<p class="notice bad">Last attempt failed: ${esc(c.recovery.last_error)}</p>` : ''}`;
  $('dFoot').innerHTML = footFor(c, s, contactLine);
}

function footFor(c, s, contactLine) {
  if (s === 'open' && state.mode === 'confirm') return `<div class="confirm"><p>Razorpay will send one link for <b>${esc(rupees(c.amount))}</b> to ${esc(contactLine)}.</p><div class="foot-row"><button class="btn btn-ink" type="button" data-act="approve">Send payment link</button><button class="btn" type="button" data-act="cancel">Cancel</button></div></div>`;
  if ((s === 'open' || s === 'held') && state.mode === 'dismiss') return `<div class="field"><label for="dReason">Why are you closing it? (optional)</label><textarea id="dReason" maxlength="280" placeholder="For example: customer paid by bank transfer"></textarea></div><div class="foot-row"><button class="btn" type="button" data-act="dismiss">Close case</button><button class="btn btn-ghost" type="button" data-act="cancel">Keep it open</button></div>`;
  if (s === 'open') return `<div class="foot-row"><button class="btn btn-ink btn-lg" type="button" data-act="confirm">Review and send link</button><button class="btn btn-ghost" type="button" data-act="ask-dismiss">Close without contacting</button></div>`;
  if (s === 'held') return `<p class="notice">The safety rules stop RecoverFlow from contacting this customer. Look into it yourself, then close the case.</p><div class="foot-row"><button class="btn" type="button" data-act="ask-dismiss">Close case</button></div>`;
  if (s === 'approving') return '<p class="notice">Creating the payment link…</p>';
  if (s === 'link_sent' && state.razorpay?.mode === 'simulated') return `<p class="notice">Demo only: pretend the customer opened the link and paid.</p><div class="foot-row"><button class="btn btn-back" type="button" data-act="demo-pay">Simulate the customer paying</button></div>`;
  if (s === 'link_sent') return '<p class="notice">This case closes by itself when the customer pays. Links expire after 3 days.</p>';
  if (s === 'recovered') return `<p class="notice">${esc(rupees(c.recovery?.recovered_amount ?? c.amount))} came back ${esc(ago(c.recovery?.recovered_at))}.</p>`;
  return '';
}

$('drawer').addEventListener('click', async e => {
  const copy = e.target.closest('[data-copy]');
  if (copy) { try { await navigator.clipboard.writeText(copy.dataset.copy); toast('Link copied'); } catch { toast('Copy failed. Select the link and copy it.'); } return; }
  const btn = e.target.closest('[data-act]'); if (!btn) return;
  const c = byId(state.openId); if (!c) return;
  const act = btn.dataset.act;
  if (act === 'confirm') { state.mode = 'confirm'; renderDrawer(c); $('dFoot').querySelector('[data-act="approve"]').focus(); return; }
  if (act === 'ask-dismiss') { state.mode = 'dismiss'; renderDrawer(c); $('dReason')?.focus(); return; }
  if (act === 'cancel') { state.mode = null; renderDrawer(c); return; }
  btn.disabled = true;
  try {
    if (act === 'approve') {
      btn.textContent = 'Sending…';
      await api(`/api/cases/${encodeURIComponent(c.id)}/approve`, {});
      state.mode = null; state.selected.delete(c.id);
      await loadCases(); loadTrend().catch(() => {});
      toast(state.razorpay?.mode === 'simulated' ? 'Payment link sent (simulated)' : 'Payment link sent');
    }
    if (act === 'dismiss') {
      await api(`/api/cases/${encodeURIComponent(c.id)}/dismiss`, { reason: $('dReason')?.value || '' });
      state.mode = null;
      await loadCases();
      toast('Case closed');
    }
    if (act === 'demo-pay') {
      await api(`/api/demo/pay/${encodeURIComponent(c.id)}`, {});
      await loadCases(); loadTrend().catch(() => {});
      const fresh = byId(c.id);
      if (fresh) renderDrawer(fresh, { slam: true });
    }
  } catch (err) {
    toast(err.message);
    if (err.status === 409) await loadCases();
    btn.disabled = false;
  }
});

/* ---------- test failure ---------- */
async function sendTest() {
  const b = $('testBtn'); b.disabled = true;
  try {
    const r = await api('/api/connect/test-event', {});
    if (location.hash !== '#inbox') location.hash = '#inbox';
    await loadCases();
    toast('Test failure received');
    if (r.id) openCase(r.id);
  } catch (err) { toast(err.message); }
  finally { b.disabled = false; }
}
$('testBtn').addEventListener('click', sendTest);

/* ---------- command palette ---------- */
const PAGES = [['inbox', 'Needs approval'], ['sent', 'Waiting for payment'], ['recovered', 'Recovered'], ['held', 'Held by safety rules'], ['all', 'All cases'], ['report', 'Weekly report'], ['audit', 'Audit trail'], ['connect', 'Connect Razorpay']];
let pItems = [], pIndex = 0;
function paletteItems(q) {
  q = q.trim().toLowerCase();
  const actions = [
    { label: 'Send a test failure', grp: 'Action', run: sendTest },
    { label: document.documentElement.dataset.theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode', grp: 'Action', run: () => $('themeBtn').click() },
    { label: announceBox.checked ? 'Stop announcing recoveries' : 'Announce recoveries out loud', grp: 'Action', run: () => { announceBox.checked = !announceBox.checked; announceBox.dispatchEvent(new Event('change')); } },
    { label: 'Keyboard shortcuts', grp: 'Action', run: () => $('help').showModal() },
  ];
  const pages = PAGES.map(([h, label]) => ({ label, grp: 'Page', run: () => { location.hash = `#${h}`; } }));
  const cases = state.cases.filter(c => !q || [nameOf(c), c.id].some(x => x.toLowerCase().includes(q))).slice(0, q ? 8 : 4)
    .map(c => ({ label: nameOf(c), sub: `${rupees(c.amount)}, ${STATUS[statusOf(c)].toLowerCase()}`, grp: 'Case', run: () => openCase(c.id) }));
  const match = x => !q || x.label.toLowerCase().includes(q);
  return [...cases, ...pages.filter(match), ...actions.filter(match)];
}
function renderPalette() {
  pItems = paletteItems($('pInput').value);
  if (pIndex >= pItems.length) pIndex = Math.max(0, pItems.length - 1);
  $('pList').innerHTML = pItems.length ? pItems.map((it, i) => `<li role="option" id="pi${i}" data-i="${i}" aria-selected="${i === pIndex}"><span>${esc(it.label)}${it.sub ? ` <small>${esc(it.sub)}</small>` : ''}</span><span class="grp">${it.grp}</span></li>`).join('') : '<li aria-disabled="true">No matches</li>';
  $('pInput').setAttribute('aria-activedescendant', pItems.length ? `pi${pIndex}` : '');
  $(`pi${pIndex}`)?.scrollIntoView({ block: 'nearest' });
}
function openPalette() { if (state.openId) closeCase(); $('pInput').value = ''; pIndex = 0; renderPalette(); $('palette').showModal(); $('pInput').focus(); }
function runPalette(i) { const it = pItems[i]; if (!it) return; $('palette').close(); it.run(); }
$('jumpBtn').addEventListener('click', openPalette);
$('pInput').addEventListener('input', () => { pIndex = 0; renderPalette(); });
$('pInput').addEventListener('keydown', e => {
  if (e.key === 'ArrowDown') { e.preventDefault(); pIndex = Math.min(pItems.length - 1, pIndex + 1); renderPalette(); }
  if (e.key === 'ArrowUp') { e.preventDefault(); pIndex = Math.max(0, pIndex - 1); renderPalette(); }
  if (e.key === 'Enter') { e.preventDefault(); runPalette(pIndex); }
});
$('pList').addEventListener('click', e => { const li = e.target.closest('[data-i]'); if (li) runPalette(Number(li.dataset.i)); });
$('palette').addEventListener('click', e => { if (e.target === $('palette')) $('palette').close(); });
$('helpBtn').addEventListener('click', () => $('help').showModal());

/* ---------- keyboard ---------- */
function moveCursor(d) {
  if (!state.list.length) return;
  state.cursor = Math.max(0, Math.min(state.list.length - 1, state.cursor + d));
  document.querySelectorAll('#rows tr').forEach((tr, i) => tr.classList.toggle('cursor', i === state.cursor));
  document.querySelector('#rows tr.cursor')?.scrollIntoView({ block: 'nearest' });
}
document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); if ($('palette').open) $('palette').close(); else openPalette(); return; }
  if (e.key === 'Escape' && state.openId) { closeCase(); return; }
  if (e.key === 'Tab' && state.openId) {
    const f = [...$('drawer').querySelectorAll('button, a[href], input, textarea, [tabindex]:not([tabindex="-1"])')].filter(n => !n.disabled && n.offsetParent);
    if (!f.length) return;
    if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f.at(-1).focus(); }
    else if (!e.shiftKey && document.activeElement === f.at(-1)) { e.preventDefault(); f[0].focus(); }
    return;
  }
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) || document.querySelector('dialog[open]');
  if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === '?') { e.preventDefault(); $('help').showModal(); return; }
  if (state.openId || !VIEWS[state.view]) return;
  const cur = state.list[state.cursor];
  if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); moveCursor(1); }
  else if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); moveCursor(-1); }
  else if (e.key === 'Enter' && cur) { e.preventDefault(); openCase(cur.id); }
  else if (e.key === 'x' && cur) { e.preventDefault(); toggleSel(cur.id); }
  else if (e.key === 'a' && cur && statusOf(cur) === 'open') { e.preventDefault(); openCase(cur.id, { confirm: true }); }
  else if (e.key === '/') { e.preventDefault(); $('search').focus(); }
});

/* ---------- report ---------- */
async function renderReport() {
  const r = await api(`/api/report?days=${state.reportDays}`);
  const max = Math.max(1, ...r.top_reasons.map(x => x.amount));
  $('report').innerHTML = `
    <p class="report-lead">${esc(state.connect?.merchant_name || 'Your store')}, the last ${r.days} days</p>
    <p class="report-big num">${esc(rupees(r.recovered_amount))}</p>
    <p class="report-line">${r.recovered_count ? `came back from ${r.recovered_count} ${r.recovered_count === 1 ? 'customer' : 'customers'} whose payments had failed.` : 'No payments came back in this period yet.'} ${r.links_sent ? `${r.recovered_count} of ${r.links_sent} links sent were paid.` : ''}</p>
    <dl class="report-grid">
      <div><dt>Failed payments</dt><dd class="num">${r.failed_count}</dd></div>
      <div><dt>Value of failures</dt><dd class="num">${esc(rupees(r.failed_amount))}</dd></div>
      <div><dt>Links sent</dt><dd class="num">${r.links_sent}</dd></div>
    </dl>
    ${r.top_reasons.length ? `<h3>Why payments failed</h3><ul class="bars">${r.top_reasons.map(x => `<li><span>${esc(REASON[x.label] || x.label)}</span><span class="bar"><span style="width:${Math.max(2, Math.round((x.amount / max) * 100))}%"></span></span><span class="num">${esc(rupees(x.amount))}</span></li>`).join('')}</ul>` : ''}
    ${r.recovered.length ? `<h3>Who paid</h3><ul class="paid-list">${r.recovered.map(x => `<li><span>${esc(x.name || x.id)} <span class="hint">${esc(when(x.recovered_at))}</span></span><b>${esc(rupees(x.amount))}</b></li>`).join('')}</ul>` : ''}`;
}
document.querySelectorAll('.seg button').forEach(b => b.addEventListener('click', () => {
  state.reportDays = Number(b.dataset.days);
  document.querySelectorAll('.seg button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  renderReport().catch(e => toast(e.message));
}));
$('printBtn')?.addEventListener('click', () => window.print());

/* ---------- audit ---------- */
async function renderAudit() {
  const r = await api('/api/audit');
  const chain = $('chain');
  chain.dataset.ok = String(r.integrity.valid);
  chain.textContent = r.integrity.valid ? `Chain intact, ${r.integrity.records} entries` : `Chain broken at entry ${r.integrity.index + 1}`;
  $('audit').innerHTML = r.audit.length ? r.audit.map(a => `<li><time datetime="${esc(a.at)}">${esc(when(a.at))}</time><div><b>${esc(a.title)}</b><p>${esc(a.detail)}</p><code>${esc(a.payment_id)} · ${esc(String(a.integrity_hash).slice(0, 12))}</code></div></li>`).join('') : '<li><div><b>No entries yet</b><p>Every webhook and decision will be recorded here.</p></div></li>';
}

/* ---------- connect ---------- */
async function loadConnect() {
  state.connect = await api('/api/connect');
  const c = state.connect;
  $('connectDot').hidden = !!(c.secret_set && c.razorpay?.ready) || c.demo;
  $('demoNote').hidden = !c.demo;
  $('wsName').textContent = c.merchant_name || 'Your store';
  $('wsMark').textContent = initials(c.merchant_name || 'R').slice(0, 1);
  $('wsMode').textContent = c.razorpay?.mode === 'simulated' ? 'Demo workspace' : c.razorpay?.ready ? `Razorpay ${c.razorpay.mode} mode` : 'Razorpay not connected';
  return c;
}
async function renderConnect() {
  const c = await loadConnect();
  const live = c.razorpay?.mode;
  const keysText = c.razorpay?.ready ? (live === 'simulated' ? 'Demo: links are simulated' : `Connected in ${live} mode`) : c.razorpay?.reason === 'live_keys_need_RAZORPAY_MODE_live' ? 'Live keys found. Set RAZORPAY_MODE=live to use them.' : 'Not connected yet';
  $('steps').innerHTML = `
    <li data-done="${c.secret_set}"><div>
      <h3>Send failed payments to RecoverFlow</h3>
      <p>In Razorpay, open <b>Account &amp; Settings</b>, then <b>Webhooks</b>, and add a webhook with this URL:</p>
      <div class="linkbox"><span>${esc(c.webhook_url)}</span><button class="btn btn-sm" type="button" data-copy="${esc(c.webhook_url)}">Copy</button></div>
      <p style="margin-top:14px">Tick these events:</p>
      <ul>${c.events.map(e => `<li><code>${esc(e)}</code></li>`).join('')}</ul>
      <p>Choose a long random secret, paste it into Razorpay, and set the same value as <code>RAZORPAY_WEBHOOK_SECRET</code> on your server.</p>
      <span class="state" data-ok="${c.secret_set}">${c.secret_set ? 'Webhook secret is set' : 'Webhook secret is missing'}</span>
    </div></li>
    <li data-done="${!!c.razorpay?.ready}"><div>
      <h3>Let RecoverFlow create payment links</h3>
      <p>In Razorpay, open <b>Account &amp; Settings</b>, then <b>API Keys</b>. Start with test mode keys and set them as <code>RAZORPAY_KEY_ID</code> and <code>RAZORPAY_KEY_SECRET</code>.</p>
      <p>Live keys only work after you also set <code>RAZORPAY_MODE=live</code>, so a test setup can never move real money.</p>
      <span class="state" data-ok="${!!c.razorpay?.ready}">${esc(keysText)}</span>
    </div></li>
    <li data-done="${!!c.last_event_at}"><div>
      <h3>Check it works</h3>
      <p>Send a signed test failure through the same path Razorpay uses. It shows up in your inbox marked “Test”.</p>
      <p><button class="btn btn-ink" type="button" id="connectTest">Send a test failure</button></p>
      <span class="state" data-ok="${!!c.last_event_at}">${c.last_event_at ? `Last failure received ${esc(ago(c.last_event_at))}` : 'No failures received yet'}</span>
    </div></li>`;
}
$('steps').addEventListener('click', async e => {
  const copy = e.target.closest('[data-copy]');
  if (copy) { try { await navigator.clipboard.writeText(copy.dataset.copy); toast('Copied'); } catch { toast('Copy failed. Select the text and copy it.'); } return; }
  if (e.target.id === 'connectTest') sendTest();
});

/* ---------- routing ---------- */
async function route() {
  const v = location.hash.slice(1) || 'inbox';
  state.view = ['inbox', 'sent', 'recovered', 'held', 'all', 'report', 'audit', 'connect'].includes(v) ? v : 'inbox';
  state.cursor = -1; state.reason = null;
  document.querySelectorAll('#nav a').forEach(a => { if (a.dataset.view === state.view) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  const section = VIEWS[state.view] ? 'cases' : state.view;
  document.querySelectorAll('.view').forEach(s => { s.hidden = s.id !== `view-${section}`; });
  try {
    if (section === 'cases') renderCases();
    if (section === 'report') { document.title = 'Weekly report · RecoverFlow'; await renderReport(); }
    if (section === 'audit') { document.title = 'Audit trail · RecoverFlow'; await renderAudit(); }
    if (section === 'connect') { document.title = 'Connect Razorpay · RecoverFlow'; await renderConnect(); }
  } catch (e) { toast(e.message); }
}
window.addEventListener('hashchange', () => { route(); $('main').focus({ preventScroll: true }); });

const syncThemeBtn = () => { $('themeBtn').textContent = document.documentElement.dataset.theme === 'dark' ? 'Light mode' : 'Dark mode'; };
$('themeBtn').addEventListener('click', () => { window.rfToggleTheme(); syncThemeBtn(); });
syncThemeBtn();

/* ---------- boot ---------- */
(async () => {
  state.me = await (window.rfMe || Promise.resolve({}));
  try { await Promise.all([loadCases(), loadConnect(), loadTrend()]); } catch (e) { toast(e.message); }
  await route();
  // Webhooks arrive at any time; refresh quietly while the tab is visible.
  setInterval(() => { if (!document.hidden) loadCases().catch(() => {}); }, 8000);
  setInterval(() => { if (!document.hidden) loadTrend().catch(() => {}); }, 60000);
})();
