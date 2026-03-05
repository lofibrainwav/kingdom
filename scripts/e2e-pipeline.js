/**
 * Kingdom E2E Pipeline Simulator
 * Discord 없이 전체 에이전트 파이프라인을 시뮬레이션한다.
 *
 * 실행: node --env-file=.env scripts/e2e-pipeline.js "태스크 설명"
 *
 * 흐름: PM → Blackboard → (Architect, Decomposer, Coder, Reviewer, Deployer) 순차 관찰
 */
const { Blackboard } = require('../agent/core/blackboard');
const { getLogger } = require('../agent/core/logger');
const log = getLogger();

const TASK = process.argv[2] || 'Hello Kingdom — README 파일을 작성해줘';
const TIMEOUT_MS = 30_000;

// 관찰할 Pub/Sub 채널 (파이프라인 순서)
const PIPELINE_CHANNELS = [
  { ch: 'pm:project_init',          label: '📋 PM → Architect', emoji: '1️⃣' },
  { ch: 'architect:design_complete', label: '🏗️  Architect → Decomposer', emoji: '2️⃣' },
  { ch: 'decomposer:plan_complete',  label: '📐 Decomposer → Coder', emoji: '3️⃣' },
  { ch: 'coder:task_complete',       label: '💻 Coder → Reviewer', emoji: '4️⃣' },
  { ch: 'reviewer:project_approved', label: '✅ Reviewer → Deployer', emoji: '5️⃣' },
  { ch: 'reviewer:task_rejected',    label: '🔄 Reviewer → FailureAgent', emoji: '↩️' },
];

async function runE2E() {
  console.log('\n🚀 Kingdom E2E Pipeline Simulator');
  console.log('━'.repeat(50));
  console.log(`📌 Task: ${TASK}`);
  console.log('━'.repeat(50) + '\n');

  const board = new Blackboard();
  const subBoard = new Blackboard();
  await board.connect();
  await subBoard.connect();

  const sub = await subBoard.createSubscriber();
  sub.on('error', (err) => log.error('e2e', 'Sub error', { error: err.message }));

  const received = [];
  const startTime = Date.now();

  // 모든 파이프라인 채널 관찰
  for (const { ch, label, emoji } of PIPELINE_CHANNELS) {
    await sub.subscribe(ch, (msg) => {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const data = typeof msg === 'string' ? JSON.parse(msg) : msg;
      console.log(`  ${emoji} [+${elapsed}s] ${label}`);
      console.log(`     └─ ${JSON.stringify(data).slice(0, 80)}...`);
      received.push({ ch, data, elapsed });
    });
  }

  // PM에게 태스크 발행
  console.log('📤 PM에게 태스크 전송 중...\n');
  await board.publish('commands:assign', {
    task: TASK,
    author: 'e2e-simulator',
  });

  // 타임아웃 대기
  await new Promise(resolve => setTimeout(resolve, TIMEOUT_MS));

  // 결과 요약
  console.log('\n' + '━'.repeat(50));
  console.log(`📊 파이프라인 결과 [${TIMEOUT_MS / 1000}초 관찰]`);
  console.log('━'.repeat(50));

  if (received.length === 0) {
    console.log('⚠️  에이전트 응답 없음 — npm start로 에이전트를 먼저 실행해주세요');
    console.log('   (PM Agent, Architect 등이 구독 중이어야 합니다)\n');
  } else {
    console.log(`✅ ${received.length}개 파이프라인 단계 완료:`);
    received.forEach(r => console.log(`   ${r.ch} (${r.elapsed}s)`));
  }

  // Blackboard 상태 확인
  const status = await board.client.hGetAll('octiv:team:status:latest').catch(() => ({}));
  if (Object.keys(status).length > 0) {
    console.log('\n📡 Blackboard 현재 에이전트 상태:');
    Object.entries(status).forEach(([k, v]) => {
      try { console.log(`   ${k}: ${JSON.parse(v).state || v}`); }
      catch { console.log(`   ${k}: ${v}`); }
    });
  }

  console.log('\n🎉 E2E 시뮬레이션 완료');
  process.exit(0);
}

runE2E().catch(err => {
  log.error('e2e', 'Fatal error', { error: err.message });
  process.exit(1);
});
