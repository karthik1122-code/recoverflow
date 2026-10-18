// RecoverFlow dashboard. Plain DOM, no framework. All server text goes through esc().
const $ = id => document.getElementById(id);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const rupees = paise => inr.format(Math.round((Number(paise) || 0) / 100));
const pct = x => `${Math.round((Number(x) || 0) * 100)}%`;
const dateFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const when = iso => { const t = Date.parse(iso); return Number.isFinite(t) ? dateFmt.format(t) : ''; };
const ago = iso => {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (!Number.isFinite(s)) return '';
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
};

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
  inbox: { title: 'Needs approval', sub: 'Failed payments the safety rules allow you to follow up. Nothing is sent until you approve.', match: s => s === 'open' || s === 'approving' },
  sent: { title: 'Waiting for payment', sub: 'Customers who have a payment link. Cases close by themselves when they pay.', match: s => s === 'link_sent' },
  recovered: { title: 'Recovered', sub: 'Money that came back after a link you approved.', match: s => s === 'recovered' },
  held: { title: 'Held by safety rules', sub: 'Failures RecoverFlow will not follow up. Review them, then close them.', match: s => s === 'held' },
  all: { title: 'All cases', sub: 'Every failed payment RecoverFlow has received.', match: () => true },
};
const EMPTY = {
  inbox: ['Nothing needs you right now', 'New failed payments appear here within seconds of Razorpay sending them.'],
  sent: ['No links are out', 'Approve a case to send its payment link.'],
  recovered: ['No recoveries yet', 'When a customer pays through a link, the case lands here with the amount.'],
  held: ['Nothing held', 'Duplicates, disputes and customers without consent would appear here.'],
  all: ['No failed payments yet', 'Connect Razorpay, or send a test failure to see how a case looks.'],
};

const state = { cases: [], summary: null, razorpay: {}, connect: null, me: {}, view: 'inbox', q: '', openId: null, seen: new Set(), reportDays: 7, firstLoad: true };

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
function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
}

/* ---------- data ---------- */
async function loadCases() {
  const data = await api('/api/cases');
  const before = new Set(state.cases.map(c => c.id));
  state.cases = data.cases;
  state.summary = data.summary;
  state.razorpay = data.razorpay;
  state.fresh = state.firstLoad ? new Set() : new Set(data.cases.filter(c => !before.has(c.id)).map(c => c.id));
  state.firstLoad = false;
  renderCounts();
  renderLedger();
  if (VIEWS[state.view]) renderTable();
  if (state.openId) { const c = byId(state.openId); if (c) renderDrawer(c); }
}
const byId = id => state.cases.find(c => c.id === id);
const statusOf = c => c.recovery?.status || 'open';

/* ---------- counts + ledger ---------- */
function renderCounts() {
  const by = state.summary?.by_status || {};
  const set = (k, n) => { const el = document.querySelector(`[data-count="${k}"]`); if (el) el.textContent = n ? n : ''; };
  set('open', (by.open || 0) + (by.approving || 0));
  set('sent', by.link_sent || 0);
  set('recovered', by.recovered || 0);
  set('held', by.held || 0);
}
function renderLedger() {
  const sum = k => state.cases.filter(c => k(statusOf(c))).reduce((s, c) => s + (k === isRec ? (c.recovery?.recovered_amount ?? c.amount) : c.amount), 0);
  const isRec = s => s === 'recovered';
  const parts = {
    recovered: sum(isRec),
    sent: sum(s => s === 'link_sent' || s === 'approving'),
    open: sum(s => s === 'open'),
    held: sum(s => s === 'held'),
  };
  const total = Object.values(parts).reduce((a, b) => a + b, 0);
  $('ledgerBar').innerHTML = total ? Object.entries(parts).filter(([, v]) => v > 0).map(([k, v]) => `<span data-k="${k}" style="flex-grow:${v}"></span>`).join('') : '';
  $('ledgerBar').setAttribute('aria-label', `${rupees(parts.recovered)} recovered, ${rupees(parts.sent)} waiting for payment, ${rupees(parts.open)} needs approval, ${rupees(parts.held)} held`);
  $('kRecovered').textContent = rupees(parts.recovered);
  $('kSent').textContent = rupees(parts.sent);
  $('kOpen').textContent = rupees(parts.open);
  $('kHeld').textContent = rupees(parts.held);
  const rate = state.summary?.recovery_rate || 0;
  const actioned = (state.summary?.by_status?.recovered || 0) + (state.summary?.by_status?.link_sent || 0) + (state.summary?.by_status?.expired || 0);
  $('kRate').textContent = actioned ? pct(rate) : '—';
}

/* ---------- table ---------- */
function renderTable() {
  const v = VIEWS[state.view];
  $('casesTitle').textContent = v.title;
  $('casesSub').textContent = v.sub;
  document.title = `${v.title} · RecoverFlow`;
  const q = state.q.trim().toLowerCase();
  const list = state.cases.filter(c => v.match(statusOf(c))).filter(c => !q || [c.customer?.name, c.id, REASON[c.diagnosis?.label], c.customer?.email].some(x => String(x || '').toLowerCase().includes(q)));
  $('tableCount').textContent = list.length ? `${list.length} ${list.length === 1 ? 'case' : 'cases'}` : '';
  $('rows').innerHTML = list.map(c => {
    const s = statusOf(c);
    const name = c.customer?.name || c.customer?.email || 'Unknown customer';
    const amount = s === 'recovered' ? (c.recovery?.recovered_amount ?? c.amount) : c.amount;
    return `<tr data-id="${esc(c.id)}" class="${state.fresh?.has(c.id) ? 'is-new' : ''}">
      <td><div class="cust"><button type="button" data-open="${esc(c.id)}">${esc(name)}${c.test_event ? '<span class="tag">Test</span>' : ''}</button><small>${esc(c.customer?.contact || c.customer?.email || c.id)}</small></div></td>
      <td class="num">${rupees(amount)}</td>
      <td class="reason">${esc(REASON[c.diagnosis?.label] || REASON.unknown)}</td>
      <td class="st"><span class="chip" data-s="${s}">${esc(STATUS[s] || s)}</span></td>
      <td class="when"><time datetime="${esc(c.received_at)}" title="${esc(when(c.received_at))}">${esc(ago(c.received_at))}</time></td>
    </tr>`;
  }).join('');
  const empty = $('empty');
  if (!list.length) {
    const [h, p] = q ? ['No matches', `Nothing in “${v.title}” matches “${state.q}”.`] : EMPTY[state.view];
    empty.innerHTML = `<h3>${esc(h)}</h3><p>${esc(p)}</p>${!q && state.view === 'all' ? '<a class="btn" href="#connect">Connect Razorpay</a>' : ''}`;
    empty.hidden = false;
    $('casesTable').hidden = true;
  } else { empty.hidden = true; $('casesTable').hidden = false; }
}
$('rows').addEventListener('click', e => { const tr = e.target.closest('tr[data-id]'); if (tr) openCase(tr.dataset.id); });
$('search').addEventListener('input', e => { state.q = e.target.value; renderTable(); });

/* ---------- drawer ---------- */
let returnFocus = null;
function openCase(id) {
  const c = byId(id); if (!c) return;
  returnFocus = document.activeElement;
  state.openId = id;
  state.mode = null;
  $('scrim').hidden = false; $('drawer').hidden = false;
  renderDrawer(c);
  $('dClose').focus();
}
function closeCase() {
  state.openId = null;
  $('scrim').hidden = true; $('drawer').hidden = true;
  if (returnFocus && document.contains(returnFocus)) returnFocus.focus();
}
$('dClose').addEventListener('click', closeCase);
$('scrim').addEventListener('click', closeCase);
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && state.openId) closeCase();
  if (e.key === 'Tab' && state.openId) { // keep focus inside the open drawer
    const f = [...$('drawer').querySelectorAll('button, a[href], input, textarea, [tabindex]:not([tabindex="-1"])')].filter(n => !n.disabled && n.offsetParent);
    if (!f.length) return;
    if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f.at(-1).focus(); }
    else if (!e.shiftKey && document.activeElement === f.at(-1)) { e.preventDefault(); f[0].focus(); }
  }
});

const ICON_OK = '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="m6.5 10.2 2.3 2.3 4.7-4.9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_STOP = '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M6.5 10h7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

function stampFor(c, slam) {
  const s = statusOf(c);
  if (s === 'recovered') return `<span class="stamp is-back${slam ? ' slam' : ''}">Recovered<small>${esc(rupees(c.recovery?.recovered_amount ?? c.amount))}</small></span>`;
  if (s === 'held') return '<span class="stamp is-held">Held</span>';
  return '<span class="stamp">Failed</span>';
}

function renderDrawer(c, { slam = false } = {}) {
  const s = statusOf(c);
  const name = c.customer?.name || 'Unknown customer';
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
      <div class="r-head"><div class="r-amount">${esc(rupees(c.amount))}</div><div class="r-stamp">${stampFor(c, slam)}</div></div>
      <div class="r-row"><span>Customer</span><span>${esc(name)}</span></div>
      <div class="r-row"><span>Payment</span><span>${esc(c.id)}</span></div>
      <div class="r-row"><span>Failed</span><span>${esc(when(c.received_at))}</span></div>
      <hr>
      <div>${esc(c.error_description || 'No reason given by the bank')}</div>
    </div>

    <section class="block">
      <h3>Why it failed</h3>
      <p><b>${esc(REASON[c.diagnosis?.label] || REASON.unknown)}</b>. ${Math.round((c.diagnosis?.confidence || 0) * 100)}% sure, based on:</p>
      <ul class="evidence">${(c.diagnosis?.evidence || []).map(e => `<li>${esc(e)}</li>`).join('')}</ul>
    </section>

    <section class="block">
      <h3>Safety check</h3>
      <div class="verdict" data-ok="${ok}">${ok ? ICON_OK : ICON_STOP}<div><b>${esc(policy[0])}</b><span>${esc(policy[1] || c.decision?.reason || '')}</span></div></div>
    </section>

    ${ok && s !== 'dismissed' ? `<section class="block sms">
      <h3>${s === 'open' ? 'What the customer will get' : 'What the customer got'}</h3>
      <div class="sms-bubble">Payment request from ${esc(merchant)} for ${esc(rupees(c.amount))}. Pay securely: <a href="${esc(link?.short_url || '#')}" ${link ? 'target="_blank" rel="noopener"' : 'tabindex="-1" aria-disabled="true"'}>${esc(link?.short_url || 'rzp.io/…')}</a></div>
      <small>Sent by Razorpay from your account by SMS and email to ${esc(contactLine)}. Sent once, never repeated.</small>
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
  if (s === 'open' && state.mode === 'confirm') return `<div class="confirm"><p>Razorpay will send one link for <b>${esc(rupees(c.amount))}</b> to ${esc(contactLine)}.</p><div class="foot-row"><button class="btn btn-pen" type="button" data-act="approve">Send payment link</button><button class="btn" type="button" data-act="cancel">Cancel</button></div></div>`;
  if ((s === 'open' || s === 'held') && state.mode === 'dismiss') return `<div class="field"><label for="dReason">Why are you closing it? (optional)</label><textarea id="dReason" maxlength="280" placeholder="For example: customer paid by bank transfer"></textarea></div><div class="foot-row"><button class="btn" type="button" data-act="dismiss">Close case</button><button class="btn btn-quiet" type="button" data-act="cancel">Keep it open</button></div>`;
  if (s === 'open') return `<div class="foot-row"><button class="btn btn-pen btn-lg" type="button" data-act="confirm">Review and send link</button><button class="btn btn-quiet" type="button" data-act="ask-dismiss">Close without contacting</button></div>`;
  if (s === 'held') return `<p class="notice">The safety rules stop RecoverFlow from contacting this customer. Look into it yourself, then close the case.</p><div class="foot-row"><button class="btn" type="button" data-act="ask-dismiss">Close case</button></div>`;
  if (s === 'approving') return '<p class="notice">Creating the payment link…</p>';
  if (s === 'link_sent' && state.razorpay?.mode === 'simulated') return `<p class="notice">Demo only: pretend the customer opened the link and paid.</p><div class="foot-row"><button class="btn btn-back" type="button" data-act="demo-pay">Simulate customer paying</button></div>`;
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
      const r = await api(`/api/cases/${encodeURIComponent(c.id)}/approve`, {});
      state.mode = null;
      await loadCases();
      toast(state.razorpay?.mode === 'simulated' ? 'Payment link sent (simulated)' : 'Payment link sent');
      if (!r.case) return;
    }
    if (act === 'dismiss') {
      await api(`/api/cases/${encodeURIComponent(c.id)}/dismiss`, { reason: $('dReason')?.value || '' });
      state.mode = null;
      await loadCases();
      toast('Case closed');
    }
    if (act === 'demo-pay') {
      await api(`/api/demo/pay/${encodeURIComponent(c.id)}`, {});
      await loadCases();
      const fresh = byId(c.id);
      if (fresh) renderDrawer(fresh, { slam: true });
      toast(`${rupees(c.amount)} recovered`);
    }
  } catch (err) {
    toast(err.message);
    if (err.status === 409) await loadCases();
    btn.disabled = false;
  }
});

/* ---------- test failure ---------- */
$('testBtn').addEventListener('click', async () => {
  const b = $('testBtn'); b.disabled = true;
  try {
    const r = await api('/api/connect/test-event', {});
    location.hash = '#inbox';
    await loadCases();
    toast('Test failure received. It is at the top of the list.');
    if (r.id) openCase(r.id);
  } catch (err) { toast(err.message); }
  finally { b.disabled = false; }
});

/* ---------- report ---------- */
async function renderReport() {
  const r = await api(`/api/report?days=${state.reportDays}`);
  const max = Math.max(1, ...r.top_reasons.map(x => x.amount));
  const period = r.days === 7 ? 'the last 7 days' : `the last ${r.days} days`;
  $('report').innerHTML = `
    <p class="report-lead">Recovered in ${esc(period)}</p>
    <p class="report-big">${esc(rupees(r.recovered_amount))}</p>
    <p class="report-line">${r.recovered_count ? `${r.recovered_count} ${r.recovered_count === 1 ? 'customer' : 'customers'} paid after a link you approved.` : 'No payments came back in this period yet.'} ${r.links_sent ? `${r.recovered_count} of ${r.links_sent} links sent were paid.` : ''}</p>
    <dl class="report-grid">
      <div><dt>Failed payments</dt><dd>${r.failed_count}</dd></div>
      <div><dt>Value of failures</dt><dd>${esc(rupees(r.failed_amount))}</dd></div>
      <div><dt>Links sent</dt><dd>${r.links_sent}</dd></div>
    </dl>
    ${r.top_reasons.length ? `<h3>Why payments failed</h3><ul class="bars">${r.top_reasons.map(x => `<li><span>${esc(REASON[x.label] || x.label)}</span><span class="bar"><span style="width:${Math.max(2, Math.round((x.amount / max) * 100))}%"></span></span><span>${esc(rupees(x.amount))}</span></li>`).join('')}</ul>` : ''}
    ${r.recovered.length ? `<h3>Who paid</h3><ul class="paid-list">${r.recovered.map(x => `<li><span>${esc(x.name || x.id)} <span class="hint">${esc(when(x.recovered_at))}</span></span><b>${esc(rupees(x.amount))}</b></li>`).join('')}</ul>` : ''}`;
}
document.querySelectorAll('.seg button').forEach(b => b.addEventListener('click', () => {
  state.reportDays = Number(b.dataset.days);
  document.querySelectorAll('.seg button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  renderReport().catch(e => toast(e.message));
}));
$('printBtn').addEventListener('click', () => window.print());

/* ---------- audit ---------- */
async function renderAudit() {
  const r = await api('/api/audit');
  const chain = $('chain');
  chain.dataset.ok = String(r.integrity.valid);
  chain.textContent = r.integrity.valid ? `Chain intact, ${r.integrity.records} entries` : `Chain broken at entry ${r.integrity.index + 1}`;
  $('audit').innerHTML = r.audit.length ? r.audit.map(a => `<li><time datetime="${esc(a.at)}">${esc(when(a.at))}</time><div><b>${esc(a.title)}</b><p>${esc(a.detail)}</p><code>${esc(a.payment_id)} · ${esc(String(a.integrity_hash).slice(0, 12))}</code></div></li>`).join('') : '<li><div><b>No entries yet</b><p>Every webhook and decision will be recorded here.</p></div></li>';
}

/* ---------- connect ---------- */
async function loadConnect() { state.connect = await api('/api/connect'); renderConnectDot(); return state.connect; }
function renderConnectDot() {
  const c = state.connect; if (!c) return;
  $('connectDot').hidden = !!(c.secret_set && c.razorpay?.ready) || c.demo;
  $('demoNote').hidden = !c.demo;
}
async function renderConnect() {
  const c = await loadConnect();
  const live = c.razorpay?.mode;
  const keysText = c.razorpay?.ready ? (live === 'simulated' ? 'Demo: links are simulated' : `Connected in ${live} mode`) : c.razorpay?.reason === 'live_keys_need_RAZORPAY_MODE_live' ? 'Live keys found. Set RAZORPAY_MODE=live to use them.' : 'Not connected yet';
  $('steps').innerHTML = `
    <li data-done="${c.secret_set}">
      <div>
        <h3>Send failed payments to RecoverFlow</h3>
        <p>In Razorpay, open <b>Account &amp; Settings</b>, then <b>Webhooks</b>, and add a webhook with this URL:</p>
        <div class="linkbox"><span>${esc(c.webhook_url)}</span><button class="btn btn-sm" type="button" data-copy="${esc(c.webhook_url)}">Copy</button></div>
        <p style="margin-top:12px">Tick these events:</p>
        <ul>${c.events.map(e => `<li><code>${esc(e)}</code></li>`).join('')}</ul>
        <p>Choose a long random secret, paste it into Razorpay, and set the same value as <code>RAZORPAY_WEBHOOK_SECRET</code> on your server.</p>
        <span class="state" data-ok="${c.secret_set}">${c.secret_set ? 'Webhook secret is set' : 'Webhook secret is missing'}</span>
      </div>
    </li>
    <li data-done="${!!c.razorpay?.ready}">
      <div>
        <h3>Let RecoverFlow create payment links</h3>
        <p>In Razorpay, open <b>Account &amp; Settings</b>, then <b>API Keys</b>. Start with test mode keys. Set them as <code>RAZORPAY_KEY_ID</code> and <code>RAZORPAY_KEY_SECRET</code>.</p>
        <p>Live keys only work after you also set <code>RAZORPAY_MODE=live</code>, so a test setup can never move real money.</p>
        <span class="state" data-ok="${!!c.razorpay?.ready}">${esc(keysText)}</span>
      </div>
    </li>
    <li data-done="${!!c.last_event_at}">
      <div>
        <h3>Check it works</h3>
        <p>Send a signed test failure through the same path Razorpay uses. It shows up in your inbox marked “Test”.</p>
        <p><button class="btn btn-pen" type="button" id="connectTest">Send a test failure</button></p>
        <span class="state" data-ok="${!!c.last_event_at}">${c.last_event_at ? `Last failure received ${esc(ago(c.last_event_at))}` : 'No failures received yet'}</span>
      </div>
    </li>`;
}
$('steps').addEventListener('click', async e => {
  const copy = e.target.closest('[data-copy]');
  if (copy) { try { await navigator.clipboard.writeText(copy.dataset.copy); toast('Copied'); } catch { toast('Copy failed. Select the text and copy it.'); } return; }
  if (e.target.id === 'connectTest') $('testBtn').click();
});

/* ---------- routing ---------- */
async function route() {
  const v = (location.hash.slice(1) || 'inbox');
  state.view = ['inbox', 'sent', 'recovered', 'held', 'all', 'report', 'audit', 'connect'].includes(v) ? v : 'inbox';
  document.querySelectorAll('#nav a').forEach(a => { if (a.dataset.view === state.view) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  const section = VIEWS[state.view] ? 'cases' : state.view;
  document.querySelectorAll('.view').forEach(s => { s.hidden = s.id !== `view-${section}`; });
  try {
    if (section === 'cases') renderTable();
    if (section === 'report') { document.title = 'Weekly report · RecoverFlow'; await renderReport(); }
    if (section === 'audit') { document.title = 'Audit trail · RecoverFlow'; await renderAudit(); }
    if (section === 'connect') { document.title = 'Connect Razorpay · RecoverFlow'; await renderConnect(); }
  } catch (e) { toast(e.message); }
}
window.addEventListener('hashchange', () => { route(); $('main').focus({ preventScroll: true }); });

$('themeBtn').addEventListener('click', () => { const t = window.rfToggleTheme(); $('themeBtn').textContent = t === 'dark' ? 'Light mode' : 'Dark mode'; });
$('themeBtn').textContent = document.documentElement.dataset.theme === 'dark' ? 'Light mode' : 'Dark mode';

/* ---------- boot ---------- */
(async () => {
  state.me = await (window.rfMe || Promise.resolve({}));
  try { await Promise.all([loadCases(), loadConnect()]); } catch (e) { toast(e.message); }
  await route();
  // Webhooks arrive at any time; refresh quietly while the tab is visible.
  setInterval(() => { if (!document.hidden) loadCases().catch(() => {}); }, 8000);
})();
