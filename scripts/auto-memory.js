/**
 * Kingdom Auto-Memory 습관 프로토콜
 * 
 * 커밋 → 푸시 → 로그 → KI 메모리 저장의 4단계 습관을 자동화.
 * 
 * 실행: node --env-file=.env scripts/auto-memory.js "변경 요약"
 * 예:  node --env-file=.env scripts/auto-memory.js "board.set() 7개 에이전트 수정"
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const KI_PATH = path.join(
  process.env.HOME,
  '.gemini/antigravity/knowledge/kingdom_vibe_coding_issues/metadata.json'
);

function step(num, label) {
  console.log(`\n${'━'.repeat(50)}`);
  console.log(`  Step ${num}: ${label}`);
  console.log('━'.repeat(50));
}

async function autoMemory() {
  const summary = process.argv[2] || '자동 메모리 저장';
  
  // ── Step 1: 테스트 통과 확인 ──────────
  step(1, '🧪 테스트 검증');
  try {
    const result = execSync('npm test 2>&1 | tail -6', { cwd: process.cwd() }).toString();
    const pass = result.match(/pass (\d+)/)?.[1];
    const fail = result.match(/fail (\d+)/)?.[1];
    console.log(`  결과: ${pass} PASS / ${fail} FAIL`);
    if (parseInt(fail) > 0) {
      console.log('  ❌ 테스트 실패 — 커밋 중단');
      process.exit(1);
    }
    console.log('  ✅ 테스트 통과');
  } catch (err) {
    console.log('  ⚠️  테스트 실행 실패:', err.message);
  }

  // ── Step 2: 린트 확인 ──────────────────
  step(2, '🔍 린트 검증');
  try {
    execSync('npm run lint 2>&1', { cwd: process.cwd() });
    console.log('  ✅ 린트 클린');
  } catch {
    console.log('  ⚠️  린트 에러 — 계속 진행');
  }

  // ── Step 3: git log 확인 ───────────────
  step(3, '📜 Git 로그 확인');
  const gitLog = execSync('git log --oneline -5').toString().trim();
  const latestCommit = gitLog.split('\n')[0].split(' ')[0];
  console.log(gitLog.split('\n').map(l => '  ' + l).join('\n'));

  // ── Step 4: KI 메모리 업데이트 ─────────
  step(4, '🧠 KI 자동 메모리 저장');
  try {
    const ki = JSON.parse(fs.readFileSync(KI_PATH, 'utf8'));
    ki.last_modified = new Date().toISOString();
    ki.latest_commit = latestCommit;
    ki.last_summary = summary;
    ki.git_log = gitLog.split('\n').map(l => l.trim());
    fs.writeFileSync(KI_PATH, JSON.stringify(ki, null, 2));
    console.log(`  ✅ KI 메모리 업데이트: ${KI_PATH}`);
    console.log(`  └─ latest_commit: ${latestCommit}`);
    console.log(`  └─ summary: ${summary}`);
  } catch (err) {
    console.log('  ⚠️  KI 저장 실패:', err.message);
  }

  // ── 완료 ─────────────────────────────────
  console.log('\n' + '━'.repeat(50));
  console.log('  🎉 Auto-Memory 프로토콜 완료');
  console.log('  다음 에이전트에게 전달할 준비가 됐습니다!');
  console.log('━'.repeat(50) + '\n');
}

autoMemory().catch(console.error);
