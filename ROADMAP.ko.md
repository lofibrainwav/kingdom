# Kingdom 로드맵

> **사명**: 인간과 에이전트가 함께 현실에서 유용한 제품, 워크플로우, 지식 시스템을 만들 수 있도록 돕는 에이전트 운영체계를 구축한다.
>
> **정신**: Truth, Goodness, Beauty, Serenity, Eternity
>
> **작성일**: 2026-03-05

---

## 전략적 전환

Kingdom은 처음에 Minecraft MVP로 시작했습니다. 그 단계는 다음 패턴이 실제로 가능하다는 것을 증명했습니다.

- 역할 기반 에이전트
- Redis 공용 메모리
- 자기 관찰
- 재사용 가능한 스킬
- 인간 중심 오케스트레이션

이제 다음 단계는 같은 패턴을 현실 세계의 작업에 적용하는 것입니다.

Minecraft는 더 이상 프로젝트 범위를 정의하지 않습니다. 이제는 origin-story adapter이자 샌드박스입니다.

---

## 핵심 시스템

| 계층 | 목적 | 핵심 자산 |
|------|------|----------|
| Planning Plane | 목표를 구조화된 작업으로 바꾼다 | `_bmad/`, `.claude/commands/`, PRD, 아키텍처 문서 |
| Knowledge Plane | 문맥을 보존하고 연결한다 | Obsidian, NotebookLM, GoT, Zettelkasten, vault sync |
| Execution Plane | 실제 작업을 수행한다 | Claude Code, Codex, Antigravity, 팀 에이전트, Blackboard |
| Governance Plane | 품질, 안전, 신뢰를 유지한다 | 테스트, 리뷰, 검증 루프, 관찰 가능성 |

---

## Phase 1 — Doctrine And Context Reset

**목표:** 저장소가 이제 Kingdom이 무엇인지 정확하게 말하게 만든다.

### 산출물
- 현실 세계용 사명에 맞춰 핵심 문서 재작성
- 계층, 에이전트, 채널, 지식 자산에 대한 표준 용어 고정
- Minecraft를 legacy/origin adapter로 명시
- `README`, `SOUL`, `ROADMAP`, 이후 `CLAUDE` 지침 정렬

### 성공 기준
- 핵심 문서 어디에도 Kingdom이 Minecraft 전용 시스템으로만 설명되지 않는다
- 새 참여자가 문서만 읽고 4계층 구조를 설명할 수 있다
- BMAD가 기본 planning/control layer로 명시된다

### 의존성
- 기존 `_bmad`, `.claude` 자산
- 현재 audit 및 roadmap 문서

---

## Phase 2 — Knowledge Plane Integration

**목표:** 흩어진 노트와 메모리를 실제로 쓰이는 공동 지능 계층으로 바꾼다.

### 산출물
- Obsidian 노트 타입과 동기화 규칙 정의
- NotebookLM 소스 적재 정책 정의
- GoT 노드/엣지 타입 공식화
- Blackboard를 통해 knowledge-update 이벤트 발행
- `skill-zettelkasten`, `got-reasoner`, `rumination-engine`, `vault-sync` 연결

### 성공 기준
- 하나의 결정이 source -> note -> GoT relationship -> agent retrieval 흐름으로 추적 가능하다
- 에이전트가 프로젝트를 매번 다시 설명받지 않고도 문맥을 얻는다
- Obsidian과 NotebookLM의 역할이 명확히 분리된다

### 의존성
- Phase 1 완료
- 안정적인 로컬 vault 및 NotebookLM 워크플로우

---

## Phase 3 — Execution Plane Refactor

**목표:** 런타임 오케스트레이션을 게임 이벤트 중심에서 현실 작업 실행 중심으로 전환한다.

### 산출물
- Blackboard 채널 재설계:
  - `work:*`
  - `knowledge:*`
  - `governance:*`
  - `execution:*`
- 팀 역할 재정의:
  - `pm-agent` -> 작업 intake와 분해
  - `architect` -> 구조 결정
  - `coder` -> 구현
  - `reviewer` -> 코드와 설계 리뷰
  - `watchdog/failure-agent` -> blocked 상태와 복구
- `swarm-orchestrator`를 실행 dispatcher로 재배치

### 성공 기준
- 스토리와 작업이 공용 런타임 채널을 통해 배정된다
- Minecraft 상태에 의존하지 않고도 실행 상태를 관찰할 수 있다
- Claude Code, Codex, Antigravity가 같은 작업 그래프를 공유할 수 있다

### 의존성
- Phase 1 완료
- green 테스트 기준선

---

## Phase 4 — Governance And Observability

**목표:** 더 높은 자율성을 안전하게 감당할 수 있을 정도로 신뢰를 높인다.

### 산출물
- 실패 중인 테스트 수정 및 green 기준선 복구
- 오케스트레이션 경계 테스트 강화
- 머지/배포 전 검증 루프 표준화
- 작업 진행, 지식 동기화, 실패 상태 대시보드 및 로그 추가
- 외부 영향 작업에 대한 승인 경계 강화

### 성공 기준
- 테스트 스위트가 다시 신뢰 가능한 기준선이 된다
- 중요한 상태 전이가 로그나 대시보드에서 관찰 가능하다
- 고위험 작업은 명시적 승인 또는 문서화된 자동화 정책을 따른다

### 의존성
- Phase 3 완료

---

## Phase 5 — Product Compounding

**목표:** 이 운영체계를 현실의 결과물을 만드는 복리 엔진으로 바꾼다.

### 산출물
- 반복 워크플로우를 재사용 가능한 command/skill로 승격
- 성공한 실행 패턴을 BMAD 템플릿으로 전환
- GoT가 재사용 가능한 전략, 에이전트, 플로우를 추천
- Kingdom 스택 위에서 실제 현실 제품/워크플로우 최소 1개 구현

### 성공 기준
- 반복 작업이 시스템의 기억 덕분에 점점 빨라진다
- Kingdom 스택으로 실제 세계의 결과물이 최소 1개 만들어진다
- 시스템이 시간이 갈수록 산출물 품질과 판단 품질을 함께 높인다

### 의존성
- Phase 1~4 완료

---

## Legacy Track — Minecraft Adapter

Minecraft는 앞으로도 다음 용도로 남겨둡니다.

- 제한된 환경에서의 증명장
- 에이전트 행동 실험용 샌드박스
- 닫힌 세계에서 오케스트레이션 패턴을 시험하는 레거시 adapter

중심축은 아니고 선택적 모듈이어야 합니다.

---

## 바로 다음 작업

1. 핵심 선언 문서 재작성 완료
2. 현재 테스트 실패 수정 및 기준선 복구
3. Knowledge Plane 계약 정의
4. Blackboard 채널을 work/knowledge/governance 중심으로 재설계
5. `CLAUDE.md`와 프로젝트 에이전트들을 새 사명에 맞게 정렬
