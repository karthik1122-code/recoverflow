/**
 * Process-level operational counters. Held in memory by design: they describe this running
 * instance (since `started_at`), while the event records and audit chain live in the store.
 * Per-minute buckets cover the last `windowMinutes` minutes for the throughput sparkline.
 */
export function createMetrics({ windowMinutes = 30, now = () => Date.now() } = {}) {
  const startedAt = now();
  const counts = { received: 0, accepted: 0, duplicates_blocked: 0, ignored: 0, signature_failures: 0, errors: 0 };
  const buckets = new Map();
  const minute = t => Math.floor(t / 60000);
  const prune = () => { const oldest = minute(now()) - windowMinutes + 1; for (const k of buckets.keys()) if (k < oldest) buckets.delete(k); };

  return {
    record(kind) {
      if (!(kind in counts)) throw new Error(`unknown metric: ${kind}`);
      counts[kind] += 1;
      if (kind === 'received') { const k = minute(now()); buckets.set(k, (buckets.get(k) || 0) + 1); prune(); }
    },
    snapshot() {
      prune();
      const current = minute(now());
      const per_minute = Array.from({ length: windowMinutes }, (_, i) => buckets.get(current - windowMinutes + 1 + i) || 0);
      return { started_at: new Date(startedAt).toISOString(), uptime_seconds: Math.round((now() - startedAt) / 1000), ...counts, per_minute };
    },
  };
}
