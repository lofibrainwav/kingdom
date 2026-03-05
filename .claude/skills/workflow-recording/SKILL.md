---
name: workflow-recording
description: Record a manual workflow once, save it as a reusable skill. Best for repetitive tasks. Create once, reuse forever. Integrates with skill-zettelkasten for compounding.
---

# Workflow Recording

## When to Use
- 반복적으로 수행하는 브라우저 작업
- 한 번 완벽하게 시연하면 영구 재사용 가능한 태스크
- 에이전트가 패턴을 학습해야 할 작업
- 복잡한 순서가 있는 UI 인터랙션

## 핵심 원칙
> "Create once, reuse forever."
한 번 직접 수행하면 에이전트가 기억 → 다음부터는 자동 실행.
skill-zettelkasten에 저장 → 복리(Compounding) 효과 발생.

## 워크플로우 녹화 절차

### Step 1: 녹화 준비
```
1. 녹화할 작업을 명확하게 정의 (목표, 시작 상태, 종료 상태)
2. 작업 이름 결정 (예: "github-pr-review", "figma-export-assets")
3. 예외 케이스 목록 작성 (실패 시 어떻게 할지)
```

### Step 2: 직접 시연 (1회)
```
[인간이 직접 수행]
→ 에이전트가 SICAC 프로토콜로 관찰:
   - 각 클릭의 DOM ref 기록
   - 입력 값 패턴 기록
   - 페이지 전환 경로 기록
   - 성공 조건 기록
```

### Step 3: 스킬 파일 생성
```
녹화 완료 후 자동으로:
/kingdom/.claude/skills/[workflow-name]/SKILL.md 생성
→ 재현 가능한 단계별 지침 포함
→ skill-zettelkasten에 노드 추가
```

### Step 4: 검증 및 등록
```
자동 재실행으로 재현 가능한지 확인
→ 성공 시: 스킬 등록 완료
→ 실패 시: 실패 지점 분석 → 수정 → 재검증
```

## 스킬 파일 템플릿

녹화된 워크플로우는 이 형식으로 저장:

```markdown
---
name: [workflow-name]
description: [한 줄 설명]
recorded: [날짜]
success-rate: [성공률]%
---

# [Workflow Name]

## 트리거 조건
- [어떤 상황에서 이 워크플로우를 사용하는지]

## 시작 상태
- URL: [시작 URL]
- 필요 조건: [로그인 여부, 데이터 준비 등]

## 단계별 실행

### Step 1: [단계명]
\`\`\`
browser_navigate url="..."
browser_wait_for selector="..."
browser_click ref="..." # [요소 설명]
browser_snapshot # 확인
\`\`\`
예상 결과: [무엇이 바뀌어야 하는지]

### Step 2: [단계명]
...

## 성공 조건
- [최종 성공 상태]

## 실패 대응
| 실패 지점 | 원인 | 대응 |
|---|---|---|
| Step 2에서 요소 없음 | 페이지 구조 변경 | 스킬 재녹화 필요 |
```

## Skill Zettelkasten 통합 (경험 복리)

```javascript
// 녹화 완료 후 자동으로 Zettelkasten에 등록
const zettelEntry = {
  id: `workflow-${workflowName}`,
  type: 'workflow-recording',
  tags: ['browser', 'automation', domain],
  successRate: 0,
  usageCount: 0,
  linkedSkills: ['chrome-browser-control', 'agent-teams'],
  recordedAt: new Date().toISOString()
};

// 사용할 때마다 성공률 업데이트 → 복리 축적
zettelkasten.updateStats(workflowName, { success: true });
```

## 자주 쓰는 워크플로우 예시

### github-pr-review
```
1. GitHub PR 목록 열기
2. 각 PR 검토 (코드 diff 확인)
3. 코멘트 작성
4. Approve 또는 Request Changes
```

### figma-to-code-export
```
1. Figma 파일 열기
2. 원하는 컴포넌트 선택
3. Inspect 패널에서 CSS/코드 복사
4. VSCode에 붙여넣기
```

### deploy-vercel-preview
```
1. GitHub 브랜치 확인
2. Vercel 대시보드 열기
3. Preview 배포 트리거
4. 배포 URL 복사해서 Slack에 공유
```

## 관리 및 업데이트

```bash
# 저장된 워크플로우 목록
ls /Users/brnestrm/bb/kingdom/.claude/skills/ | grep -v verify

# 성공률이 낮은 워크플로우 재녹화
# → 90% 미만이면 자동으로 재녹화 추천 알림
```
