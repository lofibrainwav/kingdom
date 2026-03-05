/**
 * Kingdom Party Mode — 멀티 에이전트 브레인스토밍
 * 
 * PM, Architect, Coder가 동시에 한 태스크를 분석하고
 * 각자의 관점(善·眞·美)에서 접근법을 제안한다.
 * 사용자가 선택하면 해당 방향으로 파이프라인 시작.
 * 
 * 실행: node --env-file=.env scripts/party-mode.js "태스크"
 */
const { Blackboard } = require('../agent/core/blackboard');
const { ReflexionEngine } = require('../agent/core/ReflexionEngine');
const { getLogger } = require('../agent/core/logger');
const log = getLogger();

const TASK = process.argv[2] || '사용자에게 날씨를 알려주는 Discord Bot 기능을 추가해줘';

// 세 Scholar 관점 정의 (眞善美)
const SCHOLARS = [
  {
    id: 'jang',
    name: '장영실 (眞 — 기술)',
    emoji: '⚙️',
    persona: '당신은 조선의 천재 과학자 장영실입니다. 가장 효율적이고 신뢰할 수 있는 기술적 구현을 제안합니다. 코드 품질, 성능, 테스트 가능성에 집중합니다.',
  },
  {
    id: 'yisunsin',
    name: '이순신 (善 — 전략)',
    emoji: '🛡️',
    persona: '당신은 조선의 전략가 이순신 장군입니다. 리스크 최소화, 안전한 점진적 접근, 실패 시 복구 방법을 제안합니다. 시스템 안정성과 오류 처리에 집중합니다.',
  },
  {
    id: 'shin',
    name: '신사임당 (美 — 창의)',
    emoji: '🎨',
    persona: '당신은 조선의 예술가이자 학자 신사임당입니다. 사용자 경험, 우아한 설계, 코드의 아름다움을 제안합니다. DX(개발자 경험)와 UX에 집중합니다.',
  },
];

function printDivider(label) {
  const pad = Math.max(0, 52 - label.length);
  const left = Math.floor(pad / 2);
  const right = pad - left;
  console.log('\n' + '─'.repeat(left) + ` ${label} ` + '─'.repeat(right));
}

async function runPartyMode() {
  console.log('\n🎉 Kingdom Party Mode — 멀티 에이전트 브레인스토밍');
  console.log('━'.repeat(55));
  console.log(`📌 태스크: ${TASK}`);
  console.log(`👥 참여: ${SCHOLARS.map(s => s.name).join(' · ')}`);
  console.log('━'.repeat(55));

  const board = new Blackboard();
  await board.connect();

  const engine = new ReflexionEngine();
  await engine.init();
  const sessionId = `party:${Date.now()}`;
  const proposals = [];

  // 세 Scholar가 각자 분석
  for (const scholar of SCHOLARS) {
    printDivider(`${scholar.emoji} ${scholar.name}`);

    const prompt = `${scholar.persona}

태스크: "${TASK}"

당신의 관점에서 이 태스크를 어떻게 접근할지 제안하세요.
응답 형식 (간결하게):
1. 핵심 접근법 (1~2문장)
2. 구체적 구현 단계 (번호 목록 3~5개)
3. 주의사항 또는 트레이드오프 (1문장)`;

    try {
      const response = await engine.callLLM(prompt, 'normal');

      console.log(response);
      proposals.push({ scholar, response });

      // Blackboard에 각 관점 기록
      await board.setConfig(`party:${sessionId}:${scholar.id}`, {
        scholar: scholar.name,
        proposal: response,
        timestamp: Date.now(),
      });
    } catch (err) {
      console.log(`  (LLM 응답 실패: ${err.message})`);
      console.log('  💡 ANTHROPIC_API_KEY 또는 GROQ_API_KEY를 .env에 설정해주세요');
      proposals.push({ scholar, response: null });
    }
  }

  // 합의 요청
  if (proposals.every(p => p.response)) {
    printDivider('🏛️ 세 학자의 합의');
    const consensusPrompt = `세 전문가의 의견을 종합해 최적의 구현 계획을 만드세요:

장영실(眞): ${proposals[0].response?.slice(0, 200)}

이순신(善): ${proposals[1].response?.slice(0, 200)}

신사임당(美): ${proposals[2].response?.slice(0, 200)}

태스크: "${TASK}"

위 세 관점의 장점을 결합한 최종 실행 계획을 5단계로 제시하세요.`;

    try {
      const consensus = await engine.callLLM(consensusPrompt, 'normal');
      console.log(consensus);

      await board.setConfig(`party:${sessionId}:consensus`, {
        task: TASK,
        consensus,
        scholars: SCHOLARS.map(s => s.id),
        timestamp: Date.now(),
      });
    } catch (err) {
      console.log('  (합의 생성 실패)');
    }
  }

  printDivider('결과 저장됨');
  console.log(`  Blackboard 키: party:${sessionId}:*`);
  console.log(`  npm run memory "party mode: ${TASK.slice(0, 30)}"  ← 메모리 저장`);
  console.log('━'.repeat(55) + '\n');

  await board.disconnect();
}

runPartyMode().catch(console.error);
