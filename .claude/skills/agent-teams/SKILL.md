---
name: agent-teams
description: Use when orchestrating multiple agents across parallel browser profiles, coordinated sub-tasks, or long workflows that should be decomposed into isolated execution units.
---

# Agent Teams

## When to Use
- 여러 브라우저 프로파일을 동시에 관리할 때
- 복잡한 순차 태스크를 높은 정확도로 실행할 때
- 단일 에이전트로는 컨텍스트가 너무 길어지는 작업
- 병렬 처리로 속도를 높여야 할 때

## 아키텍처

```
[Main Agent — 오케스트레이터]
        │
        ├─ Sub-Agent A (Profile 1 / Task A)
        ├─ Sub-Agent B (Profile 2 / Task B)
        ├─ Sub-Agent C (Profile 3 / Task C)
        └─ Sub-Agent D (Profile 4 / Task D)

통신: MCP (실시간 컨텍스트 동기화)
Blackboard: octiv:agent-teams:* 채널
```

## 실행 패턴

### Pattern 1: 순차 파이프라인 (Sequential Pipeline)
각 서브에이전트가 이전 결과를 받아서 처리:
```
A 완료 → 결과 → B 시작 → 결과 → C 시작 → 최종 보고
```
**사용**: 의존성이 있는 다단계 작업

### Pattern 2: 병렬 스웜 (Parallel Swarm)
독립적인 태스크를 동시에 실행:
```
A, B, C, D 동시 시작 → 각자 완료 → 결과 통합
```
**사용**: 독립적인 파일 여러 개, 데이터 수집

### Pattern 3: 팬-아웃 / 팬-인 (Fan-out / Fan-in)
```
Main → [A, B, C] 동시 실행 → 결과 수집 → Main이 통합
```
**사용**: 같은 작업을 여러 대상에게, A/B 테스트

## 마스터 프롬프트 구조

```
[Main Agent에게 입력]

Opus/Claude 모드로 시작.

1. Profile 1 열기 → [사이트 A] 로그인 → 작업 A 실행 → 스크린샷 저장
2. Profile 2로 전환 → [사이트 B] 접속 → 데이터 추출 → Documents에 저장
3. Profile 3 → 작업 C 실행
4. Profile 4 완료 후 → 전체 요약 보고서 작성

각 단계 완료 후: "Step X 완료, 계속할까요?" 확인 요청
에러 발생 시: 자동 롤백 + 재시도 (최대 3회)
```

## Blackboard 채널 (kingdom 통합)

```javascript
// 태스크 배분
board.publish('octiv:agent-teams:task', {
  taskId: 'at-001',
  subAgent: 'A',
  profile: 1,
  instructions: '...'
});

// 진행 상황 모니터링
board.subscribe('octiv:agent-teams:progress', (data) => {
  console.log(`Sub-agent ${data.agent}: ${data.status}`);
});

// 결과 수집
board.subscribe('octiv:agent-teams:result', (data) => {
  results.push(data);
  if (results.length === totalAgents) synthesize(results);
});
```

## 성능 기준 (2026-03 기준)

| 태스크 유형 | 성공률 |
|---|---|
| 단순 태스크 (폼 입력, 가격 비교) | 98% |
| 복잡한 순차 태스크 (4사이트 로그인 + 데이터 이동) | 87~94% |
| 장기 태스크 (30분 이상) 에러 복구율 | 92% |

## Multi-Clauding (5~10 병렬 세션)

긴 태스크에서 속도 극대화:
```
세션 1: 컴포넌트 A 개발
세션 2: 컴포넌트 B 개발
세션 3: 테스트 작성
세션 4: 문서화
세션 5: 코드 리뷰
→ 하나가 느려도 나머지가 보완 → 전체 성공률 극대화
```

## BMAD Party Mode와 통합

설계 결정 시 Architect + PM + UX Expert를 동시에 협의:
```
/bmad-help 를 통해 파티 모드 진입
→ 여러 BMAD 페르소나가 동시에 분석
→ 합의된 결정 → Blackboard에 브로드캐스트
```

## Implementation

- Use this skill when one agent should orchestrate multiple isolated execution contexts.
- Prefer explicit task ownership, progress events, and result synthesis over implicit coordination.
- Route durable decisions back through Blackboard and the knowledge plane after execution completes.
