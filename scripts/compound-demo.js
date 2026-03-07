#!/usr/bin/env node
/**
 * Kingdom Compound Skill Demonstrator
 * 
 * 기존 씨앗 스킬들을 함께 사용하면 XP가 쌓이고,
 * 충분히 함께 쓰이면 자동으로 Compound Skill이 생성된다.
 * 
 * 실행: node --env-file=.env scripts/compound-demo.js
 */
const { SkillZettelkasten } = require('../agent/memory/skill-zettelkasten');
const { Blackboard } = require('../agent/core/blackboard');
const { getLogger } = require('../agent/core/logger');
const log = getLogger();

// 함께 자주 쓰이는 스킬 쌍 시나리오
const CO_OCCURRENCE_SCENARIOS = [
  // "커밋 전 테스트" 패턴 — 검증된 커밋 복합 스킬 후보
  { primary: 'test-runner',  coSkills: ['lint-checker', 'git-commit'],  label: 'verified-commit' },
  // "코드 리뷰 후 배포" 패턴
  { primary: 'code-reviewer', coSkills: ['test-runner', 'git-commit'],  label: 'reviewed-deploy' },
  // "API 결과 정리" 패턴
  { primary: 'api-caller',    coSkills: ['markdown-formatter'],          label: 'api-doc' },
  // "LLM 결과 커밋" 패턴
  { primary: 'llm-prompter',  coSkills: ['file-writer', 'git-commit'],   label: 'llm-commit' },
];

// Zettelkasten 임계값: 이 횟수 이상 함께 쓰여야 Compound 후보
const CO_OCCURRENCE_THRESHOLD = 3;

async function runCompoundDemo() {
  console.log('\n🔬 Kingdom Compound Skill Demonstrator');
  console.log('━'.repeat(55));
  console.log('스킬들이 함께 사용되면 Compound Skill이 자동 생성됩니다');
  console.log('━'.repeat(55) + '\n');

  const board = new Blackboard();
  await board.connect();
  const zk = new SkillZettelkasten(board, process.env.OBSIDIAN_VAULT || '/tmp/kingdom-vault');
  await zk.init();

  // Phase A: 시나리오별 co-occurrence 시뮬레이션
  console.log('📌 Phase A — Co-occurrence 시뮬레이션 (각 패턴 3회)\n');

  for (const scenario of CO_OCCURRENCE_SCENARIOS) {
    process.stdout.write(`  패턴 [${scenario.label}]: `);
    for (let i = 0; i < CO_OCCURRENCE_THRESHOLD; i++) {
      await zk.recordUsage(scenario.primary, true, {
        coUsedWith: scenario.coSkills,
        context: `${scenario.label}-demo-${i + 1}`,
      });
      process.stdout.write(`${i + 1} `);
    }
    // co-skill들도 성공 기록
    for (const co of scenario.coSkills) {
      await zk.recordUsage(co, true, { context: `co-with-${scenario.primary}` });
    }
    console.log('✅');
  }

  // Phase B: 강력한 링크 확인
  console.log('\n📌 Phase B — 형성된 스킬 링크 (상위 10개)\n');
  const links = await zk.getStrongestLinks(0.1, 10);
  if (links.length === 0) {
    console.log('  (아직 링크 없음 — 더 많은 공동 사용이 필요)');
  } else {
    links.forEach(l => {
      const strength = (l.strength * 100).toFixed(0);
      console.log(`  🔗 ${l.from} ↔ ${l.to}: ${strength}% (${l.coOccurrences}회 공동 사용)`);
    });
  }

  // Phase C: Compound Skill 목록 확인
  console.log('\n📌 Phase C — 자동 생성된 Compound Skills\n');
  const allNotes = await zk.getAllNotes();
  const allNotesArray = Object.values(allNotes);

  const compounds = allNotesArray.filter(n => n.status === 'compound' || n.compoundOf);
  
  if (compounds.length === 0) {
    console.log('  (아직 없음 — recordUsage()가 임계값을 넘으면 자동 생성됩니다)');
    console.log(`  현재 임계값: ${CO_OCCURRENCE_THRESHOLD}회 공동 사용`);
  } else {
    compounds.forEach(c => {
      console.log(`  🧬 ${c.name} [Tier: ${c.tier}, XP: ${c.xp}]`);
      console.log(`     └─ 구성: ${(c.compoundOf || []).join(' + ')}`);
    });
  }

  // Phase D: 전체 XP 현황
  console.log('\n📌 Phase D — 스킬 XP 현황 (Top 8)\n');
  const stats = await zk.getStats();
  const sorted = allNotesArray
    .filter(n => n.status === 'active' || n.status === 'compound')
    .sort((a, b) => (b.xp || 0) - (a.xp || 0))
    .slice(0, 8);

  sorted.forEach(n => {
    const bar = '█'.repeat(Math.min(20, Math.floor((n.xp || 0) / 5)));
    const tier = n.tier || 'Novice';
    console.log(`  ${n.name.padEnd(22)} ${tier.padEnd(12)} XP:${String(n.xp||0).padStart(4)} ${bar}`);
  });

  console.log(`\n  총 스킬: ${stats.totalNotes}개 | Compound: ${stats.compoundNotes || 0}개`);
  console.log(`  평균 성공률: ${((stats.avgSuccessRate || 0) * 100).toFixed(1)}%`);

  console.log('\n' + '━'.repeat(55));
  console.log('🎉 Compound Skill 시연 완료');
  console.log('  npm run memory "compound skill 데모 실행"  ← 메모리 저장');
  console.log('━'.repeat(55) + '\n');

  await zk.shutdown();
  // board.disconnect() is handled if zk shares it, or we explicitly exit
  process.exit(0);
}

runCompoundDemo().catch(err => {
  console.error(err);
  process.exit(1);
});
