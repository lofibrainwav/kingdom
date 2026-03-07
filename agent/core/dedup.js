/**
 * Simple event deduplication guard.
 * Tracks processed event keys with TTL-based expiry.
 */
class DedupGuard {
  constructor(maxSize = 1000, ttlMs = 300000) {
    this.seen = new Map(); // key -> timestamp
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }

  /**
   * Returns true if this key has NOT been seen (safe to process).
   * Returns false if duplicate (skip processing).
   */
  check(key) {
    if (!key) return true;
    this._prune();
    if (this.seen.has(key)) return false;
    this.seen.set(key, Date.now());
    return true;
  }

  _prune() {
    const now = Date.now();
    if (this.seen.size <= this.maxSize) return;
    for (const [key, ts] of this.seen) {
      if (now - ts > this.ttlMs) this.seen.delete(key);
    }
  }

  get size() {
    return this.seen.size;
  }
}

module.exports = { DedupGuard };
