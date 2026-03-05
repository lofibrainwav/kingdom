---
name: chrome-browser-control
description: DOM-based Chrome browser automation via Playwright MCP. 3-5x more accurate than vision-only. Handles clicks, form input, JS execution, multi-tab management.
---

# Chrome Browser Control

## When to Use
- 웹 브라우저 자동화가 필요한 모든 상황
- DOM 직접 제어가 필요한 경우 (Vision-only 대비 3~5배 정확)
- JavaScript 실행, 폼 입력, 페이지 탐색
- 스크린샷 캡처 및 데이터 추출

## 핵심 원칙
**DOM 직접 접근 + 접근성 트리 파싱 + Vision** 3중 조합으로 Human-level 92~95% 성공률.

## 안전 규칙 (Iron Law)
1. **항상 스냅샷 먼저** — 클릭/타입 전 접근성 트리 확인
2. **단계별 검증** — 각 액션 후 결과 확인
3. **실패 시 자동 롤백** — 3회 재시도 후 인간에게 보고
4. **Draft Only 모드** — 중요한 액션은 승인 후 실행

## Pre-Action Protocol (SICAC)

모든 브라우저 액션은 이 5단계를 따른다:

```
1. SNAPSHOT  →  접근성 트리 읽기 (DOM 구조 파악)
2. IDENTIFY  →  대상 요소 찾기 (text + role로 식별)
3. CONTEXT   →  주변 요소 확인 (올바른 페이지/섹션인지)
4. ACT       →  액션 실행 (클릭, 타입, 네비게이션)
5. CONFIRM   →  결과 검증 (스냅샷으로 상태 변화 확인)
```

## Playwright MCP 명령 예시

### 페이지 이동
```
browser_navigate url="https://example.com"
browser_wait_for selector=".main-content"
```

### 요소 클릭 (SICAC 적용)
```
# 1. SNAPSHOT
browser_snapshot

# 2-3. IDENTIFY + CONTEXT
# → 접근성 트리에서 "Submit" 버튼 ref 확인

# 4. ACT
browser_click ref="<ref-from-snapshot>"

# 5. CONFIRM
browser_snapshot  # 상태 변화 확인
```

### 텍스트 입력
```
browser_snapshot
browser_type ref="<input-ref>" text="내용 입력"
browser_snapshot  # 입력 확인
```

### JavaScript 실행 (DOM 직접 제어)
```
browser_evaluate script="document.querySelector('.target').innerText"
browser_evaluate script="window.scrollTo(0, document.body.scrollHeight)"
```

### 스크린샷 및 데이터 추출
```
browser_screenshot
browser_evaluate script="JSON.stringify(Array.from(document.querySelectorAll('td')).map(td => td.innerText))"
```

## 에러 분류 및 대응

| 에러 타입 | 증상 | 대응 |
|---|---|---|
| `element_not_found` | 스냅샷에 ref 없음 | 페이지 완전 로드 후 재시도 |
| `wrong_element` | 액션 성공 but 결과 다름 | text+role 재확인 후 재시도 |
| `navigation_failure` | URL 불일치, auth 리디렉트 | 로그인 상태 확인 |
| `content_not_loaded` | 스냅샷에 핵심 요소 없음 | `browser_wait_for` 후 재시도 |
| `js_error` | JS 실행 실패 | 페이지 재로드 후 재시도 |

## 글로벌 안전 규칙

- **Draft Only**: 이메일 발송, 폼 제출, 구매 등 → 반드시 확인 후 실행
- **Ask before acting**: 각 단계 완료 후 "Step X 완료, 계속할까요?" 확인
- **Max retries**: 3회 실패 시 자동 중단 + 인간 보고
- **Sandbox 우선**: 테스트 환경에서 검증 후 프로덕션 적용

## Multi-Profile 자동화

여러 Chrome 프로파일을 순서대로 자동화할 때:

```
1. 프로파일 1 열기 → 작업 A → 스크린샷 저장
2. 프로파일 2로 전환 → 작업 B → 데이터 추출
3. 프로파일 3으로 전환 → 작업 C
4. 최종 보고서 작성 후 완료
→ agent-teams 스킬과 조합하면 병렬 처리 가능
```
