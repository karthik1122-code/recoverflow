import { statusOf } from './cases.mjs';

const DAY = 86_400_000;
const within = (iso, from, to) => { const t = Date.parse(iso || ''); return t >= from && t <= to; };

/** What RecoverFlow did for a merchant in a window: the numbers for the weekly "we got you ₹X back" report. */
export function buildReport(records, { days = 7, now = Date.now() } = {}) {
  const span = Math.min(Math.max(Math.round(Number(days)) || 7, 1), 90);
  const from = now - span * DAY, to = now;
  const failed = records.filter(r => within(r.received_at, from, to));
  const recovered = records.filter(r => statusOf(r) === 'recovered' && within(r.recovery?.recovered_at, from, to));
  const sent = records.filter(r => (r.recovery?.history || []).some(h => h.to === 'link_sent' && within(h.at, from, to)) || (statusOf(r) === 'recovered' && within(r.recovery?.approved_at, from, to)));
  const reasons = new Map();
  for (const r of failed) {
    const key = r.diagnosis?.label || 'unknown';
    const entry = reasons.get(key) || { label: key, count: 0, amount: 0 };
    entry.count += 1; entry.amount += Number(r.amount) || 0;
    reasons.set(key, entry);
  }
  const recovered_amount = recovered.reduce((s, r) => s + (r.recovery?.recovered_amount ?? r.amount ?? 0), 0);
  const failed_amount = failed.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  return {
    days: span,
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
    failed_count: failed.length,
    failed_amount,
    links_sent: sent.length,
    recovered_count: recovered.length,
    recovered_amount,
    recovery_rate: sent.length ? Math.round((recovered.length / sent.length) * 1000) / 1000 : 0,
    top_reasons: [...reasons.values()].sort((a, b) => b.amount - a.amount).slice(0, 5),
    recovered: recovered.sort((a, b) => Date.parse(b.recovery.recovered_at) - Date.parse(a.recovery.recovered_at)).slice(0, 50)
      .map(r => ({ id: r.id, name: r.customer?.name || null, amount: r.recovery?.recovered_amount ?? r.amount, reason: r.diagnosis?.label, recovered_at: r.recovery.recovered_at })),
  };
}
