import { referenceIdFor, statusOf, transition } from './cases.mjs';

/**
 * A case can be left in `approving` if the process dies between claiming it and hearing back
 * from Razorpay. We never guess: ask Razorpay whether a link with the case's reference exists.
 * Found → record it as link_sent. Not found → release the case so a human can approve again.
 * Razorpay unreachable → leave it for the next sweep.
 */
export async function sweepStaleApprovals({ store, provider, staleMs = 10 * 60_000, now = Date.now() }) {
  const { events } = await store.snapshot();
  const stale = events.filter(e => statusOf(e) === 'approving' && now - Date.parse(e.recovery?.approved_at || 0) >= staleMs);
  const result = { checked: stale.length, linked: 0, released: 0, skipped: 0 };
  for (const record of stale) {
    let link;
    try { link = await provider.findPaymentLinkByReference(referenceIdFor(record.id)); } catch { result.skipped += 1; continue; }
    let changed = false;
    const updated = await store.updateEvent(record.id, r => {
      if (statusOf(r) !== 'approving') return r; // someone else finished it meanwhile
      changed = true;
      return link ? transition(r, 'link_sent', link) : transition(r, 'release', { error: 'approval did not finish; no payment link was created' });
    }, r => !changed ? null : statusOf(r) === 'link_sent'
      ? { title: 'Unfinished approval completed', detail: `Found link ${link.id} at Razorpay; the case is marked as sent.`, payment_id: r.id }
      : statusOf(r) === 'open' ? { title: 'Unfinished approval released', detail: 'No payment link exists at Razorpay, so nothing reached the customer. The case is open again.', payment_id: r.id } : null);
    if (!changed) continue;
    if (statusOf(updated) === 'link_sent') result.linked += 1;
    else if (statusOf(updated) === 'open') result.released += 1;
  }
  return result;
}
