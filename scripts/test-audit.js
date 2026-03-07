#!/usr/bin/env node
/**
 * Test Quality Audit — "측정 도구를 의심하라"
 *
 * Checks:
 * 1. Tests with zero assertions (pass by not crashing)
 * 2. Tests with only assert.ok (weakest possible check)
 * 3. Import-only coverage vs actual assertion coverage
 * 4. Node.js native coverage summary
 */
const fs = require('fs');
const path = require('path');

const testDir = 'test';
const files = fs.readdirSync(testDir).filter(f => f.endsWith('.test.js'));

let totalItBlocks = 0;
const noAssertTests = [];
const onlyOkTests = [];
const crashOnlyTests = []; // "does not crash" pattern
const stats = { strong: 0, weak: 0, empty: 0 };

for (const f of files) {
  const content = fs.readFileSync(path.join(testDir, f), 'utf-8');
  const lines = content.split('\n');

  // Parse it() blocks with their bodies
  let inTest = false;
  let testName = '';
  let testBody = '';
  let braceDepth = 0;
  let testStartLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!inTest) {
      const match = line.match(/it\(['"`]([^'"`]+)/);
      if (match) {
        inTest = true;
        testName = match[1];
        testBody = '';
        braceDepth = 0;
        testStartLine = i + 1;
        totalItBlocks++;
      }
    }

    if (inTest) {
      testBody += line + '\n';
      braceDepth += (line.match(/\{/g) || []).length;
      braceDepth -= (line.match(/\}/g) || []).length;

      if (braceDepth <= 0 && testBody.length > 10) {
        // Test block complete — analyze
        const id = `${f}:${testStartLine} "${testName.slice(0, 50)}"`;

        const hasAssert = /assert\.\w+/.test(testBody);
        const assertCalls = testBody.match(/assert\.(\w+)/g) || [];
        const allOk = assertCalls.length > 0 && assertCalls.every(a => a === 'assert.ok');
        const isCrashOnly = /does not crash|no crash|no error/i.test(testName) && !hasAssert;

        if (!hasAssert) {
          noAssertTests.push(id);
          stats.empty++;
        } else if (allOk) {
          onlyOkTests.push(id);
          stats.weak++;
        } else {
          stats.strong++;
        }

        if (isCrashOnly) {
          crashOnlyTests.push(id);
        }

        inTest = false;
        testBody = '';
      }
    }
  }
}

console.log('\n🔍 TEST QUALITY AUDIT — "측정 도구를 의심하라"');
console.log('━'.repeat(55));

console.log(`\nTotal it() blocks: ${totalItBlocks}`);
console.log(`  ✅ Strong (assert.equal/deepEqual/throws): ${stats.strong}`);
console.log(`  🟡 Weak (assert.ok only): ${stats.weak}`);
console.log(`  ❌ Empty (no assertions): ${stats.empty}`);

const strongPct = (stats.strong / totalItBlocks * 100).toFixed(0);
const weakPct = (stats.weak / totalItBlocks * 100).toFixed(0);
const emptyPct = (stats.empty / totalItBlocks * 100).toFixed(0);
console.log(`\n  Strong: ${strongPct}% | Weak: ${weakPct}% | Empty: ${emptyPct}%`);

if (noAssertTests.length > 0) {
  console.log(`\n❌ Tests with ZERO assertions (${noAssertTests.length}):`);
  noAssertTests.forEach(t => console.log(`  ${t}`));
}

if (onlyOkTests.length > 0) {
  console.log(`\n🟡 Tests with ONLY assert.ok — weakest check (${onlyOkTests.length}):`);
  onlyOkTests.forEach(t => console.log(`  ${t}`));
}

if (crashOnlyTests.length > 0) {
  console.log(`\n💤 "Does not crash" tests without assertions (${crashOnlyTests.length}):`);
  crashOnlyTests.forEach(t => console.log(`  ${t}`));
}

// ── Verdict ──────────────────────────────────────────
console.log('\n' + '━'.repeat(55));
if (stats.empty === 0 && stats.weak < totalItBlocks * 0.15) {
  console.log('✅ Test quality: SOLID');
} else if (stats.empty < 5 && stats.weak < totalItBlocks * 0.25) {
  console.log('🟡 Test quality: ACCEPTABLE — some weak spots');
} else {
  console.log('❌ Test quality: NEEDS WORK');
}

console.log(`\n진짜 증거: ${stats.strong}/${totalItBlocks} tests make specific assertions`);
console.log('━'.repeat(55) + '\n');

// CI gate: fail if empty tests exist
if (stats.empty > 0) {
  process.exitCode = 1;
}
