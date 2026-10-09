import { createHash } from 'node:crypto';

function hash(value) { return createHash('sha256').update(value).digest('hex'); }
function canonical(record) { return JSON.stringify({id:record.id, title:record.title, detail:record.detail, payment_id:record.payment_id, at:record.at, previous_hash:record.previous_hash}); }

export function appendAudit(chain, {title, detail, payment_id}) {
  const record = {id:`audit_${Date.now()}_${chain.length}`, title, detail, payment_id, at:new Date().toISOString(), previous_hash:chain[0]?.integrity_hash || 'GENESIS'};
  record.integrity_hash = hash(canonical(record));
  chain.unshift(record);
  return record;
}

/**
 * Verify hash links from newest to oldest. When old records have been dropped to cap memory,
 * `anchor` is the hash of the last dropped record, so the oldest retained record is still checked.
 */
export function verifyAuditChain(chain, anchor = 'GENESIS') {
  for (let index = 0; index < chain.length; index += 1) {
    const record = chain[index];
    if (record.integrity_hash !== hash(canonical(record))) return {valid:false, index, reason:'record_hash_mismatch'};
    const older = chain[index + 1];
    if ((older?.integrity_hash || anchor) !== record.previous_hash) return {valid:false, index, reason:'chain_link_mismatch'};
  }
  return {valid:true, records:chain.length, head_hash:chain[0]?.integrity_hash || 'GENESIS'};
}
