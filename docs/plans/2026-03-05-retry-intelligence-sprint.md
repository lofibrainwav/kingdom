# Retry Intelligence to Learning Visibility Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Connect retry pressure, task memory, and dashboard observability so operators can see what each task learned, how often recovery succeeds, and keep drill-down context stable.

**Architecture:** Reuse the current Blackboard config store as the durable join point between task state and knowledge captures. Extend the dashboard state API and UI in three small stories: attach the latest knowledge capture to each task, compute resolved-rate metrics from retry and resolution events, then persist drill-down focus in URL query state.

**Tech Stack:** Node.js, Redis-backed Blackboard config store, plain HTML dashboard, Node test runner, ESLint.

---

## Brief

- **Epic:** Retry Intelligence to Learning Visibility
- **Sprint Goal:** Make retry and recovery observable as task-level learning instead of disconnected counters.
- **Definition of Done:**
  - Task state returned by `/api/state` can include latest knowledge summary.
  - Dashboard exposes recovery-quality metrics, not just retry volume.
  - Drill-down focus can be restored after refresh via URL query params.
  - New behavior is covered by targeted tests before implementation.
  - Full regression gates remain green: `npm test`, `npm run lint`, `node scripts/run-skill-evals.js`.

## Story 1: Task Knowledge Link

**Files:**
- Modify: `agent/memory/knowledge-operator.js`
- Modify: `agent/interface/dashboard.js`
- Test: `test/knowledge-operator.test.js`
- Test: `test/interface-copy.test.js`
- Test: `test/dashboard-state.test.js`

**Intent:**
- Persist the latest knowledge capture by `projectId/taskId`.
- Join that capture into dashboard task payloads and render a compact summary on each task card.

### Task 1.1: Write failing tests for capture indexing
- Add a failing test proving task-complete captures write a latest-capture index keyed by task.
- Add a failing test proving `/api/state` includes task-level knowledge summary when present.

### Task 1.2: Implement minimal capture index
- Store a compact latest-capture config from `KnowledgeOperator.capture()` when a bundle includes `taskId`.
- Join indexed capture summaries onto tasks in dashboard state responses.

### Task 1.3: Render task knowledge summary
- Add latest lesson/improvement/timestamp lines to task cards.
- Keep empty-state copy concise when no knowledge capture exists.

### Task 1.4: Verify
- Run focused tests for `knowledge-operator` and dashboard state.
- Run full regression commands.

## Story 2: Recovery Rate Metrics

**Files:**
- Modify: `agent/interface/dashboard.js`
- Test: `test/dashboard-state.test.js`
- Test: `test/interface-copy.test.js`

**Intent:**
- Compute recovery quality from retry events and resolved captures at project/task granularity.

### Task 2.1: Write failing tests for rate aggregation
- Add tests for project-level and task-level resolved-rate output.

### Task 2.2: Implement metric aggregation
- Add derived metrics for retry count, resolved count, and resolved rate.
- Surface project/task recovery sections in dashboard state and UI.

### Task 2.3: Verify
- Run focused tests, then full regression commands.

## Story 3: Persistent Drill-Down

**Files:**
- Modify: `agent/interface/dashboard.js`
- Test: `test/dashboard-state.test.js`
- Test: `test/interface-copy.test.js`

**Intent:**
- Preserve active task focus across refreshes and shareable dashboard URLs.

### Task 3.1: Write failing tests for query handling
- Add tests for reading query params into dashboard state fetches and reset behavior.

### Task 3.2: Implement URL-backed focus
- Sync drill-down state into `window.history`.
- Bootstrap dashboard state from query params and preserve filters after reload.

### Task 3.3: Verify
- Run focused tests, then full regression commands.

## Execution Order

1. Story 1
2. Story 2
3. Story 3

## Commit Plan

1. `feat: link task state to latest knowledge capture`
2. `feat: add recovery rate metrics`
3. `feat: persist dashboard drilldown state`
