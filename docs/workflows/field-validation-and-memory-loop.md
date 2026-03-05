# Field Validation And Memory Loop

## Goal

Turn real execution into durable knowledge so Kingdom gets easier to operate over time.

## Trigger

Run this workflow after:
- a meaningful implementation
- a bug fix
- a new workflow
- a real-world test of an agent or tool chain

## Workflow

### 1. Define the field check

Write down:
- what was supposed to happen
- what was actually tested
- what success looked like

### 2. Execute the check

Examples:
- run the relevant tests
- run the local workflow
- query the knowledge source
- simulate or observe the actual execution path

### 3. Record the result

Classify the result as:
- passed
- partially passed
- failed
- inconclusive

### 4. Extract the lesson

Ask:
- what worked reliably?
- what assumption broke?
- what should change in process, code, or documentation?

### 5. Store the lesson

Store in the right layer:
- Obsidian for session memory, debugging notes, pattern notes, ADR links
- NotebookLM for durable source-worthy documents
- GoT for relationship-aware knowledge reuse

### 6. Update the system

Convert the lesson into one or more of:
- a new note
- a revised workflow
- a test
- a prompt/agent update
- a skill or command

## Minimum Evidence Standard

Do not claim “learned” unless at least one of these exists:
- test evidence
- command output
- workflow artifact
- note with concrete before/after description

## Compounding Rule

The loop is complete only when the next person or next session can use the lesson with less effort than the last one.
