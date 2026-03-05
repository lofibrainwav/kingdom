# Kingdom

> 공유 지식, 엄격한 실행, 복리처럼 쌓이는 기억을 기반으로 현실의 유용한 시스템을 만드는 에이전트 운영체계.

## 시작점

`kingdom`은 처음에 마인크래프트 MVP로 시작했습니다.

그 첫 세계는 중요한 증명이었습니다.

- 에이전트가 공용 메모리를 통해 상태를 공유할 수 있고
- 역할을 나눠 협업할 수 있으며
- 실패를 관찰하고 개선할 수 있고
- 반복 작업을 스킬로 축적할 수 있다는 점을 보여줬기 때문입니다

이제 마인크래프트는 프로젝트의 경계가 아니라 출발점입니다.

## 지금의 Kingdom

Kingdom은 인간이 방향을 잡고 에이전트가 실행을 분담하는 현실 세계용 개발 운영체계입니다.

핵심 구성:

- `BMAD`: 계획, 분해, 산출물, 전달 체계
- `Redis Blackboard`: 실시간 협업 버스
- `Obsidian`: 작업 기억과 연결된 프로젝트 문맥
- `NotebookLM`: 근거 기반 지식 저장소
- `GoT`: 관계형 지식 추론 계층
- `Claude Code`, `Codex`, `Antigravity`: 주요 실행 인터페이스

목표는 게임 속 봇을 만드는 것이 아니라, 현실에서 실제로 쓸 수 있는 제품, 워크플로우, 시스템을 만드는 것입니다.

## 시스템 4계층

### 1. Planning Plane

BMAD가 다음을 정의합니다.

- 제품 브리프
- PRD
- 아키텍처
- 에픽과 스토리
- 구현 준비도
- 스프린트 체크포인트

### 2. Knowledge Plane

지식 계층은 역할을 분리합니다.

- `Obsidian`: 세션 노트, ADR, 프로젝트 메모, 작업 기억
- `NotebookLM`: 검증 가능한 자료와 레퍼런스
- `GoT`: 스킬, 실패, 패턴, 결정 사이의 관계를 연결하는 추론 계층

### 3. Execution Plane

실행은 다음을 중심으로 이루어집니다.

- `Claude Code`
- `Codex`
- `Antigravity`
- 로컬 Node.js 에이전트
- Blackboard 채널

### 4. Governance Plane

품질과 안전은 다음으로 유지합니다.

- 테스트
- 리뷰 루프
- 검증 워크플로우
- 관찰 가능성
- 승인 규칙과 안전 가드레일

## 저장소 구조

```text
kingdom/
├── agent/               # 코어 런타임, 인터페이스, 메모리, 팀 에이전트
├── config/              # 공유 설정
├── docs/                # 감사 문서, 계획 문서, 원칙 문서
├── scripts/             # 지원 스크립트와 데모
├── test/                # Node.js 네이티브 테스트
├── _bmad/               # BMAD 워크플로우와 역할 정의
├── .claude/             # Claude 명령, 에이전트, 프로젝트 스킬
├── server/              # 레거시 Minecraft MVP 자산과 origin-story adapter
└── README.ko.md
```

## 현재 방향

가까운 목표는 게임 세계 중심 에이전트 스택을 현실 문제를 다루는 시스템으로 완전히 전환하는 것입니다.

즉:

1. 선언과 로드맵 정렬
2. 테스트 기준선 복구
3. Knowledge Plane 통합
4. 실행 오케스트레이션 리팩터링
5. 제품 중심 런타임 흐름 구축

## 레거시 자산의 위치

Minecraft 런타임은 여전히 저장소에 남아 있지만, 역할은 다음으로 제한됩니다.

- origin story
- 실험용 샌드박스
- 선택적 adapter

프로젝트 전체를 정의하는 중심은 아닙니다.

## 당장 해야 할 일

1. 핵심 문서를 새로운 사명에 맞게 정렬
2. 실패 중인 테스트를 고쳐 신뢰 가능한 기준선 복구
3. Blackboard 채널을 work, knowledge, governance 중심으로 재설계
4. Obsidian, NotebookLM, GoT를 공동 지식 시스템으로 고정
5. BMAD 워크플로우를 기본 control plane으로 승격
