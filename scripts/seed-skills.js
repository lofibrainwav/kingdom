#!/usr/bin/env node
/**
 * Kingdom Skill Seed Library
 * 
 * 초기 스킬 10개를 Zettelkasten에 등록하는 씨앗 스크립트.
 * Redis가 실행 중인 상태에서: node scripts/seed-skills.js
 * 
 * 각 스킬은 첫 Novice 등급으로 시작 → 사용할수록 XP를 얻어 Tier Up.
 */
const { SkillZettelkasten } = require('../agent/memory/skill-zettelkasten');
const { Blackboard } = require('../agent/core/blackboard');

const SEED_SKILLS = [
  {
    name: 'file-writer',
    description: '파일을 생성하거나 덮어쓴다. path, content를 받아 저장.',
    category: 'io',
    tags: ['file', 'write', 'create'],
  },
  {
    name: 'git-commit',
    description: 'git add -A 후 commit message로 커밋한다.',
    category: 'vcs',
    tags: ['git', 'commit', 'version-control'],
  },
  {
    name: 'test-runner',
    description: 'npm run test를 실행하고 결과(pass/fail 수)를 반환한다.',
    category: 'quality',
    tags: ['test', 'verify', 'quality'],
  },
  {
    name: 'lint-checker',
    description: 'npm run lint를 실행하고 에러 목록을 반환한다.',
    category: 'quality',
    tags: ['lint', 'style', 'quality'],
  },
  {
    name: 'api-caller',
    description: 'HTTP GET/POST 요청을 보내고 JSON 응답을 반환한다.',
    category: 'network',
    tags: ['http', 'api', 'fetch'],
  },
  {
    name: 'redis-publisher',
    description: 'Blackboard 채널에 메시지를 publish한다.',
    category: 'messaging',
    tags: ['redis', 'publish', 'blackboard'],
  },
  {
    name: 'llm-prompter',
    description: 'LLM(Claude/Groq)에 프롬프트를 보내고 텍스트 응답을 반환한다.',
    category: 'ai',
    tags: ['llm', 'claude', 'groq', 'generate'],
  },
  {
    name: 'markdown-formatter',
    description: '텍스트를 마크다운 형식으로 변환하거나 표/리스트를 생성한다.',
    category: 'formatting',
    tags: ['markdown', 'format', 'document'],
  },
  {
    name: 'env-checker',
    description: '필수 환경변수 목록을 확인하고 누락된 것을 보고한다.',
    category: 'ops',
    tags: ['env', 'config', 'check'],
  },
  {
    name: 'code-reviewer',
    description: '코드를 분석하여 버그, 보안 이슈, 개선점을 제안한다.',
    category: 'quality',
    tags: ['review', 'code', 'quality', 'security'],
  },
];

async function seedSkills() {
  const board = new Blackboard();
  await board.connect();

  const zk = new SkillZettelkasten(board, process.env.OBSIDIAN_VAULT || '/tmp/kingdom-vault');
  await zk.init();

  console.log('🌱 Kingdom Skill Seed Library 등록 시작...\n');

  let registered = 0;
  for (const skill of SEED_SKILLS) {
    try {
      const existing = await zk.getNote(skill.name.replace(/-/g, '_').replace(/[^a-z0-9_]/gi, ''));
      if (existing) {
        console.log(`⏭️  이미 존재: ${skill.name} (XP: ${existing.xp || 0})`);
        continue;
      }

      await zk.createNote({
        name: skill.name,
        description: skill.description,
        errorType: skill.category,
        agentId: 'seed-script',
        code: `// ${skill.name}\n// ${skill.description}`,
      });

      console.log(`✅ 등록: ${skill.name} [${skill.category}]`);
      registered++;
    } catch (err) {
      console.log(`❌ 실패: ${skill.name} — ${err.message}`);
    }
  }

  console.log(`\n🎉 완료: ${registered}개 새로 등록, ${SEED_SKILLS.length - registered}개 이미 존재`);
  console.log('Zettelkasten이 활성화되었습니다 — 이제 에이전트들이 XP를 쌓기 시작합니다!');

  await board.disconnect();
}

seedSkills().catch(console.error);
