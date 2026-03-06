# Kingdom Workflow Contract

This repository uses a task-first workflow. Agents and humans coordinate around explicit work units, not ad hoc prompts.

## Default Lifecycle

1. Intake
2. Planning
3. Workspace preparation
4. Execution
5. Review and governance
6. Knowledge capture
7. Closeout

## Required Inputs

Each meaningful task should have:

- `projectId`
- `taskId`
- `goal`
- clear acceptance target
- at least one verification path

## Event Contract

Kingdom uses canonical Blackboard events for task flow:

- `work:intake`
- `work:planning:init`
- `work:planning:designed`
- `work:planning:decomposed`
- `work:task:started`
- `execution:task:workspace-ready`
- `governance:review:requested`
- `governance:review:approved`
- `governance:review:rejected`
- `governance:failure:retry-requested`
- `governance:task:completed`
- `knowledge:capture:stored`

## Workspace Rule

Every task should run in a deterministic workspace path:

- `workspace/<projectId>/<taskId>`

If stronger isolation is needed later, this path can map to a worktree or container. The contract stays the same.

## Verification Rule

Do not mark a task complete unless:

- code or artifact exists
- verification was attempted
- governance result is recorded

## Knowledge Rule

Validated work should become reusable memory.

Minimum bundle:

- one durable note
- one verification artifact or explicit verification record
- one reusable lesson or pattern

## Serial Vs Parallel

Prefer serial execution when:

- architecture is changing
- shared state is high
- the next step depends on the previous result

Prefer parallel execution when:

- tasks are independent
- research and implementation can split
- review can converge outputs later

## Current Runtime Mapping

- `PMAgent` handles intake and planning init
- `Architect` handles design
- `Decomposer` handles task breakdown
- `CoderAgent` executes task plans
- `Reviewer` and `FailureAgent` govern outcomes
- `KnowledgeOperator` captures validated lessons
- `TaskRunner` owns task lifecycle state and workspace preparation
