# Blackboard Channel Spec

This document defines the canonical event vocabulary for Kingdom's Redis blackboard.

## Principles

- Producers and consumers should use canonical channel names.
- Legacy channel names remain as compatibility aliases in [`agent/core/blackboard.js`](../agent/core/blackboard.js).
- Prefix handling and JSON parsing belong to the Blackboard subscriber wrapper, not to individual agents.

## Planes

### Work

- `work:intake`: initial human or interface task intake
- `work:planning:init`: PM starts planning for a project
- `work:planning:designed`: architect completes design context
- `work:planning:decomposed`: decomposer publishes task plan
- `work:task:started`: a task has entered execution with a declared goal

### Execution

- `execution:dispatch:<agentId>`: direct task dispatch to an agent
- `execution:broadcast:<agentId>`: broadcast command mirrored per agent
- `execution:swarm:spawn`: request swarm creation
- `execution:swarm:terminate`: request swarm termination
- `execution:task:workspace-ready`: the deterministic workspace for a task is prepared
- `execution:deployment:completed`: deployer finished a deployment

### Knowledge

- `knowledge:capture:stored`: a validated milestone or lesson bundle was stored in the vault
- `knowledge:skill:eval-completed`: a skill evaluation run produced a quality score
- `knowledge:skills:deployed`: skill pipeline deployed a new skill
- `knowledge:rumination:digested`: rumination cycle completed with insights
- `knowledge:zettelkasten:tier-up`: a skill advanced to a new tier
- `knowledge:zettelkasten:compound-created`: zettelkasten forged a compound skill
- `knowledge:got:completed`: GoT reasoning cycle completed
- `knowledge:reflexion:triggered`: leader/reflexion plane emitted a reflexion event

### Governance

- `governance:review:requested`: coder published a task result for review
- `governance:review:approved`: reviewer approved a task result
- `governance:review:rejected`: reviewer rejected a task result
- `governance:failure:retry-requested`: failure agent classified a failure and requested retry
- `governance:task:completed`: a task closed with explicit verification evidence
- `governance:project:approved`: reviewer approved a project for deployment
- `governance:watchdog:recovery`: watchdog initiated a recovery action
- `governance:safety:threat`: safety plane detected a threat

## Compatibility Rule

When renaming a channel:

1. Add the canonical-to-legacy alias in `Blackboard`.
2. Move producers to the canonical name.
3. Move consumers to the canonical name.
4. Keep one compatibility test at the Blackboard layer.
5. Remove the alias only after all consumers and operators are migrated.
