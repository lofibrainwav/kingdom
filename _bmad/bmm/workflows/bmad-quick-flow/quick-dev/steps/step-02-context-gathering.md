---
name: 'step-02-context-gathering'
description: 'Quick context gathering for direct mode - identify files, patterns, dependencies'

nextStepFile: './step-03-execute.md'
---

# Step 2: Context Gathering (Direct Mode)

**Goal:** Quickly gather context for direct instructions - files, patterns, dependencies.

**Note:** This step only runs for Mode B (direct instructions). If `{execution_mode}` is "tech-spec", this step was skipped.

---

## AVAILABLE STATE

From step-01:

- `{baseline_commit}` - Git HEAD at workflow start
- `{execution_mode}` - Should be "direct"
- `{project_context}` - Loaded if exists

---

## EXECUTION SEQUENCE

### 0. Auto-Research (Kingdom Integration)

Before touching code, gather external knowledge:

- **Codebase search**: Grep/Glob for existing implementations of similar functionality
- **Vault knowledge**: Check `bb/03-Skills/debugging.md`, `bb/03-Skills/accuracy-rules.md`, `bb/01-Projects/kingdom/patterns.md` for relevant lessons
- **Grok research** (if `GROK_MCP_URL` is set): Query Grok for best practices:
  `node scripts/dev-research.js "<user's task description>"`
  This auto-searches codebase + vault + asks Grok in one shot.
- **Prior art**: Check if similar code exists elsewhere in the project before writing new

Output: 3-5 bullet summary of research findings. This context feeds into the plan.

### 1. Identify Files to Modify

Based on user's direct instructions:

- Search for relevant files using glob/grep
- Identify the specific files that need changes
- Note file locations and purposes

### 2. Find Relevant Patterns

Examine the identified files and their surroundings:

- Code style and conventions used
- Existing patterns for similar functionality
- Import/export patterns
- Error handling approaches
- Test patterns (if tests exist nearby)

### 3. Note Dependencies

Identify:

- External libraries used
- Internal module dependencies
- Configuration files that may need updates
- Related files that might be affected

### 4. Create Mental Plan

Synthesize gathered context into:

- List of tasks to complete
- Acceptance criteria (inferred from user request)
- Order of operations
- Files to touch

---

## PRESENT PLAN

Display to user:

```
**Context Gathered:**

**Files to modify:**
- {list files}

**Patterns identified:**
- {key patterns}

**Plan:**
1. {task 1}
2. {task 2}
...

**Inferred AC:**
- {acceptance criteria}

Ready to execute? (y/n/adjust)
```

- **y:** Proceed to execution
- **n:** Gather more context or clarify
- **adjust:** Modify the plan based on feedback

---

## NEXT STEP DIRECTIVE

**CRITICAL:** When user confirms ready, explicitly state:

- **y:** "**NEXT:** Read fully and follow: `step-03-execute.md`"
- **n/adjust:** Continue gathering context, then re-present plan

---

## SUCCESS METRICS

- Files to modify identified
- Relevant patterns documented
- Dependencies noted
- Mental plan created with tasks and AC
- User confirmed readiness to proceed

## FAILURE MODES

- Executing this step when Mode A (tech-spec)
- Proceeding without identifying files to modify
- Not presenting plan for user confirmation
- Missing obvious patterns in existing code
