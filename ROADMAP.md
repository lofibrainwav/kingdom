# Octiv Project Roadmap
> **Goal**: Complete a sandbox where an AI agent team autonomously survives, builds, and manages resources on a PaperMC Minecraft server.
>
> **Spirit**: 眞善美孝永 — Truth, Goodness, Beauty, Serenity, Eternity
>
> **Date**: 2026-03-03 | **Lead Dev**: Claude | **Commander**: Octiv

---

## Team

| Role | Owner | Description |
|------|-------|-------------|
| **Commander** | Octiv | Project direction, NotebookLM resource management |
| **Lead Developer** | Claude (Cowork) | Code, architecture, debugging, roadmap |
| **Dev Environment B** | Anti-Gravity (Google IDE + Gemini) | Parallel dev, NotebookLM integration, Gemini assistant |
| **Agent Framework** | OpenClaw | Agent runtime, skill system, LLM bridge |

---

## Current Status (v0.1 — 2 commits)

### Implemented
- [x] Project structure (agent/, skills/, config/, logs/)
- [x] Docker Compose (Redis + PaperMC)
- [x] Blackboard module (Redis Pub/Sub shared memory)
- [x] bot.js single bot test (mineflayer connection, basic commands)
- [x] team.js team orchestrator (Leader + Builder×3 + Safety)
- [x] leader.js (mode decision, voting, Group Reflexion)
- [x] builder.js (wood collection AC-1, tool crafting AC-3, ReAct loop)
- [x] safety.js (threat detection AC-8, vm2 sandbox validation)
- [x] first-day-survival v1.3.1 skill definition (BMAD format)
- [x] .env + OpenClaw agent configuration

### Not Yet Implemented
- [ ] AC-2: Shelter construction logic (missing from builder.js)
- [ ] AC-4: Agent shelter gathering verification
- [ ] AC-5: Self-Improvement actual implementation (failure → skill creation)
- [ ] AC-6: Group Reflexion → system prompt injection
- [ ] AC-7: memory.md write logic
- [ ] Leader ↔ Builder ↔ Safety real integrated communication
- [ ] LLM bridge (bridge:8765) connection
- [ ] NotebookLM ↔ MCP integration
- [ ] Dynamic skill library loading
- [ ] HEARTBEAT dashboard
- [ ] Tests (framework present, tests empty)

---

## Phase 1 — Foundation
> Goal: Confirm a single bot runs stably on the server

### 1.1 Infrastructure Verification
- [x] Docker Compose startup confirmed (Redis + PaperMC)
- [x] Redis connection test (Blackboard → publish/get working)
- [x] RCON command execution confirmed (server status query)

### 1.2 Single Bot Stabilization
- [x] bot.js connects → spawns → basic operation verified
- [x] mineflayer + pathfinder movement/mining stability tested
- [x] Error handling hardened (reconnect, timeout, exception handling)

### 1.3 Blackboard Integration Test
- [x] bot.js → publish status to Blackboard → verify in Redis
- [x] Pub/Sub channel subscribe/publish verified
- [x] AC progress update → query cycle tested

### Milestone
```
✅ docker compose up → Redis PONG, MC server MOTD confirmed
✅ node agent/bot.js → bot spawns, responds to !status !pos
✅ octiv:agent:*:status keys found in Redis
```

---

## Phase 2 — Core Gameplay
> Goal: Complete AC-1 through AC-4 of the first-day-survival mission

### 2.1 AC-1: Wood Collection (16 logs)
- Debug and stabilize builder.js collectWood()
- Support multiple wood types (oak, spruce, birch, jungle)
- Implement 60s timeout + trigger Reflexion on failure

### 2.2 AC-2: Shelter Construction (3×3×3+)
- Block placement algorithm (site selection → floor → walls → roof)
- Y-level safety check (flat ground, avoid water/lava)
- Door placement + lighting

### 2.3 AC-3: Tool Crafting
- Stabilize craftBasicTools() (inventory check → place crafting table → craft)
- Auto-collect loop when materials are insufficient

### 2.4 AC-4: Agent Gathering
- Share shelter coordinates via Blackboard
- All agents move to shelter + arrival verification
- 1200 tick timer implementation

### Milestone
```
✅ Builder collects 16 wood (within 60s)
✅ 3×3×3 shelter auto-built
✅ Crafting table + wooden pickaxe crafted
✅ All agents gathered in shelter (verified via Blackboard)
```

---

## Phase 3 — Team Orchestration
> Goal: Real communication and role coordination between Leader-Builder-Safety

### 3.1 Leader ↔ Builder Integration
- Leader distributes missions → Builder receives → executes
- Training Mode / Creative Mode switch logic working
- Voting system (2/3 majority) implemented

### 3.2 Safety Real-Time Monitoring
- Safety Agent monitors all Builder states via Blackboard
- AC-8 threat detected → immediate warning broadcast
- vm2 validation pipeline working

### 3.3 Group Reflexion
- 3 consecutive failures → Leader forces Group Reflexion
- Reflexion result → team-wide strategy update
- Reflexion history saved (Blackboard + memory.md)

### Milestone
```
✅ Leader switches "training" → "creative" mode
✅ Safety threat detected → team-wide warning within 1s
✅ Group Reflexion executed → strategy change applied
```

---

## Phase 4 — Self-Improvement Engine (AC-5, 6, 8)
> Goal: Automatically generate, validate, and deploy new skills on failure

### 4.1 Self-Improvement Pipeline
- Failure detected → request skill generation from LLM → parse JSON response
- vm2 sandbox 3x dry-run validation
- Blackboard skills:emergency channel broadcast

### 4.2 Dynamic Skill Library Management
- Store/retrieve skills in Redis (Blackboard.saveSkill/getSkill)
- Real-time skill success_rate updates
- Daily limit of 5 + discard if estimated_success_rate < 0.7

### 4.3 LLM Bridge Connection
- bridge:8765 endpoint integration (GLM-4.7 / GPT / Gemini)
- Cost guardrail ($0.01/attempt)
- Fallback: use existing safe skill if LLM fails

### 4.4 Dynamic System Prompt Injection (AC-6)
- Group Reflexion result → inject "[Learned Skill v1.3]"
- Real-time system prompt update for all agents

### Milestone
```
✅ Lava death → evacuate_lava_v1 skill auto-generated
✅ vm2 validation passes → skills:emergency broadcast
✅ New skill used immediately in next ReAct loop
```

---

## Phase 5 — Knowledge Bridge
> Goal: Connect NotebookLM resources via MCP, enable Claude ↔ Anti-Gravity bidirectional dev

### 5.1 NotebookLM ↔ MCP Integration
- NotebookLM MCP server setup (using existing notebooklm tool)
- Search technical docs/strategy from notebook → reflect in agent behavior
- Auto-sync project progress to NotebookLM

### 5.2 Claude ↔ Anti-Gravity Collaboration Protocol
- Shared codebase: Git-based sync
- File ownership rules documented
- Unified commit convention (emoji + English description)

### 5.3 Gemini Skill Integration
- skills/gemini → real Gemini API connection
- Fast Q&A, summarization, strategy assist
- Cost optimization (Gemini = fast tasks, GPT/GLM = complex reasoning)

### Milestone
```
✅ Search "optimal wood collection strategy" in NotebookLM → result returned
✅ Code written by Claude → available in Anti-Gravity immediately via Git
✅ Gemini skill responds correctly to agent Q&A
```

---

## Phase 6 — Monitoring & Dashboard (Observability)
> Goal: Commander can monitor team status in real time

### 6.1 HEARTBEAT Dashboard
- Web-based real-time dashboard (React or HTML)
- Per-agent position, health, inventory, AC progress display
- Mission timeline visualization

### 6.2 Logging & Alerts
- Structured log system (using logs/ directory)
- Threat events → commander alert (Discord/channel)
- Daily mission report auto-generation

### 6.3 Memory System
- Automatic memory.md logging (AC-7)
- Daily notes (memory/YYYY-MM-DD.md)
- MEMORY.md long-term memory curation

### Milestone
```
✅ http://localhost:3000 in browser → dashboard displayed
✅ Safety warning → Discord alert within 1s
✅ Mission ends → auto-recorded to memory.md
```

---

## Phase 7 — Scale & Extend
> Goal: Build a long-term operations framework beyond first-night survival

### 7.1 Mission Expansion
- Week 2: Ore mining + stone tool upgrade
- Week 3: Farm automation + food self-sufficiency
- Week 4: Ender Dragon strategy planning

### 7.2 Agent Enhancement
- Expand agent count (Builder 3→5+)
- Role specialization (farmer, miner, explorer, architect)
- Natural language negotiation between agents (LLM-based)

### 7.3 Infrastructure Expansion
- LM Studio local model integration (cost reduction)
- Multi-server support
- Plugin system (KubeJS integration)

---

## Schedule

| Phase | Name | Duration | Prerequisites |
|-------|------|----------|---------------|
| **1** | Foundation | 1–2 days | Docker, Node.js environment |
| **2** | Core Gameplay | 3–5 days | Phase 1 complete |
| **3** | Team Orchestration | 3–5 days | Phase 2 complete |
| **4** | Self-Improvement | 5–7 days | Phase 3 + LLM bridge |
| **5** | Knowledge Bridge | 3–5 days | NotebookLM resources ready |
| **6** | Monitoring | 3–5 days | Can run parallel after Phase 3 |
| **7** | Scale & Extend | Ongoing | After Phase 4 complete |

---

## Working Principles

1. **Session start**: Read ROADMAP.md + recent git log → identify current Phase
2. **Commit convention**: `emoji Phase-N: English description` (e.g. `🎮 P2: stabilize AC-1 wood collection`)
3. **Test first**: Write tests before implementing new features
4. **Cost awareness**: Always enforce cost guardrails on LLM calls
5. **Report duty**: Report status to commander when a Phase is complete

---

> _"眞善美孝永 — Read accurately, act safely, build beautifully, report peacefully, sustain eternally."_
