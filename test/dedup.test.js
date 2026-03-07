const { describe, it } = require('node:test');
const assert = require('node:assert');
const { DedupGuard } = require('../agent/core/dedup');

describe('DedupGuard', () => {
  it('allows first occurrence of a key', () => {
    const guard = new DedupGuard();
    assert.strictEqual(guard.check('a'), true);
  });

  it('blocks duplicate key', () => {
    const guard = new DedupGuard();
    assert.strictEqual(guard.check('a'), true);
    assert.strictEqual(guard.check('a'), false);
  });

  it('allows different keys', () => {
    const guard = new DedupGuard();
    assert.strictEqual(guard.check('a'), true);
    assert.strictEqual(guard.check('b'), true);
  });

  it('allows null/empty keys (pass-through)', () => {
    const guard = new DedupGuard();
    assert.strictEqual(guard.check(null), true);
    assert.strictEqual(guard.check(''), true);
    assert.strictEqual(guard.check(undefined), true);
  });

  it('tracks size correctly', () => {
    const guard = new DedupGuard();
    assert.strictEqual(guard.size, 0);
    guard.check('a');
    assert.strictEqual(guard.size, 1);
    guard.check('b');
    assert.strictEqual(guard.size, 2);
    guard.check('a'); // duplicate — no size change
    assert.strictEqual(guard.size, 2);
  });

  it('prunes expired entries when maxSize exceeded', () => {
    const guard = new DedupGuard(2, 1);
    guard.check('a');
    guard.check('b');
    guard.check('c'); // size=3 now (a,b,c)
    // Backdate a and b so they're expired
    guard.seen.set('a', 0);
    guard.seen.set('b', 0);
    // Next check triggers _prune — size=3 > maxSize=2, so expired a,b get removed
    guard.check('d');
    // After prune: a,b removed, c,d remain
    assert.strictEqual(guard.size, 2);
    // 'a' should be allowed again (was pruned)
    assert.strictEqual(guard.check('a'), true);
  });

  it('does not prune when under maxSize', () => {
    const guard = new DedupGuard(100, 0);
    guard.check('a');
    guard.check('b');
    // Under maxSize, no prune even if expired
    assert.strictEqual(guard.check('a'), false); // still blocked
  });
});
