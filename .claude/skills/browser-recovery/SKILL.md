# Browser Failure Recovery — SKILL.md

## Iron Law

**NO BROWSER CLICK WITHOUT PRIOR SNAPSHOT VERIFICATION.**

Every browser interaction follows the Pre-Action Protocol. No exceptions.

---

## Pre-Action Protocol (SICAC)

Every browser action — click, type, navigate, select — must follow these 5 steps:

```
1. SNAPSHOT   →  browser_snapshot (get accessibility tree)
2. IDENTIFY   →  Find target element ref, verify text/role matches intent
3. CONTEXT    →  Check surrounding elements, verify correct page section
4. ACT        →  Perform the action (click, type, navigate, select)
5. CONFIRM    →  browser_snapshot again, verify expected state change occurred
```

### SNAPSHOT
- Use `browser_snapshot` (NOT screenshot) — accessibility tree is machine-readable
- If page is loading, use `browser_wait_for` first

### IDENTIFY
- Match element by **text content AND role**, not just ref number
- Verify the element description matches your intent exactly
- Red flag: generic icons ("+", "...", gear) without checking adjacent text

### CONTEXT
- Verify you are on the correct page/tab/section
- Check that surrounding elements match expectations
- Example: "Add source" button only valid when Sources tab is active

### ACT
- Use the correct tool: `browser_click`, `browser_type`, `browser_navigate`
- One action at a time — never chain without intermediate verification

### CONFIRM
- Take another `browser_snapshot` immediately after the action
- Verify the expected state change:
  - Navigation: URL changed to expected value
  - Click: Dialog/menu appeared, or element state changed
  - Type: Input field contains expected text
  - Submit: Success indicator visible

---

## Error Classification

5 error types, mirroring `agent/builder-adaptation.js` classifyError pattern:

| Type | Symptoms | Example |
|------|----------|---------|
| `element_not_found` | Target ref missing from snapshot | Button removed by dynamic JS |
| `wrong_element` | Action succeeded but wrong result | Clicked "+" (new notebook) instead of "Add source" |
| `navigation_failure` | URL mismatch, auth redirect, 404 | Google auth redirect during NotebookLM access |
| `content_not_loaded` | Key elements missing from snapshot | Page loaded but dynamic content not rendered |
| `state_mismatch` | Page structure differs from expected | Modal overlay blocking target, unexpected tab state |

### Classification Logic

```
IF target ref not in snapshot           → element_not_found
IF action completed but result wrong    → wrong_element
IF URL is not what was expected         → navigation_failure
IF snapshot has fewer elements than expected → content_not_loaded
IF unexpected modal/overlay/state       → state_mismatch
```

---

## Recovery Strategies (per type)

Each error type has an ordered recovery chain. Try Strategy 1 first, then 2, then 3. After 3 failures, escalate to user.

### `element_not_found`
1. **Alternative selector**: Search snapshot for element with similar text/role
2. **Scroll and re-snapshot**: Element may be below fold — scroll down, re-snapshot
3. **Re-navigate**: Go back to known-good URL, re-navigate to target page

### `wrong_element`
1. **Undo + re-snapshot**: Navigate back, take fresh snapshot, verify element text matches
2. **Explicit navigation**: Use `browser_navigate` to go directly to correct page
3. **Close unwanted state**: Close any opened dialogs/tabs, return to starting point

### `navigation_failure`
1. **Retry navigation**: Try the same URL once more (transient network issue)
2. **Check auth**: If redirected to login, handle authentication flow first
3. **Alternative URL**: Try alternate route to the same destination

### `content_not_loaded`
1. **Wait longer**: Use `browser_wait_for` with specific text/element
2. **Reload**: Navigate to same URL again to force fresh load
3. **Check network**: Use `browser_network_requests` to identify failed requests

### `state_mismatch`
1. **Dismiss overlay**: Look for close/dismiss buttons on modals, click them
2. **Explicit navigation**: Navigate directly to the expected page state
3. **Full reload**: `browser_navigate` to the base URL and start the flow over

---

## Retry Protocol

1. **Maximum 3 attempts** per action
2. **Never repeat the same approach** — each retry must use a different strategy
3. **Escalate after 2 consecutive failures** of different strategies — ask user for guidance
4. **Log every attempt**: Record what was tried and why it failed for pattern learning

### Retry Decision Tree

```
Attempt 1: Primary action (SICAC protocol)
  ↓ FAIL
Classify error → Pick Strategy 1 for that type
  ↓ FAIL
Pick Strategy 2 for that type (MUST be different from Strategy 1)
  ↓ FAIL
Pick Strategy 3 OR escalate to user
  ↓ FAIL
STOP — Ask user for manual intervention
```

---

## Playwright MCP Patterns

### Standard Action Flow

```
# 1. Snapshot
browser_snapshot → get accessibility tree

# 2. Identify + Context
Find ref for target element
Verify: element text matches intent
Verify: surrounding elements confirm correct section

# 3. Act
browser_click(ref=<verified_ref>, element="<description>")

# 4. Confirm
browser_snapshot → verify state change
```

### Common Playwright MCP Sequences

**Safe Navigation**:
```
browser_navigate(url) → browser_wait_for(text="<expected>") → browser_snapshot
```

**Safe Click**:
```
browser_snapshot → verify ref → browser_click(ref) → browser_snapshot → verify change
```

**Safe Form Fill**:
```
browser_snapshot → verify field ref → browser_type(ref, text) → browser_snapshot → verify value
```

**Safe File Upload**:
```
browser_snapshot → find upload trigger → browser_click(ref) → browser_file_upload(paths)
```

### Tab Management
- Before acting: `browser_tabs(action="list")` to verify active tab
- After opening new tab: `browser_tabs(action="select", index=N)` to switch
- Clean up: `browser_tabs(action="close")` for unwanted tabs

---

## Patchright Patterns

For Google-authenticated sites (NotebookLM, etc.), use the `BrowserRecovery` class from `browser_recovery.py`:

```python
from browser_recovery import BrowserRecovery

recovery = BrowserRecovery(page, max_retries=3)

# Safe click with fallback selectors
await recovery.click_with_fallback(
    selectors=['button:has-text("Add source")', '[aria-label="Add source"]'],
    verify_after=lambda p: p.locator('text=Copied text').is_visible()
)

# Wait with recovery
await recovery.wait_for_element(
    selectors=['[role="tab"]:has-text("Sources")'],
    timeout=10000
)

# State verification
await recovery.verify_page_state(
    url_pattern="notebooklm.google.com",
    required_elements=['[role="tab"]:has-text("Sources")']
)
```

---

## Red Flags — STOP and Re-verify

These situations require immediate SNAPSHOT before proceeding:

1. **Generic icon without context check** — "+", "...", gear icons can mean different things in different sections
2. **Clicking without prior snapshot** — violates Iron Law
3. **Multiple similar buttons on page** — verify the specific one by surrounding context
4. **Page URL doesn't match expected** — you may have been redirected
5. **Action completed too fast** — no visible state change may mean wrong element was clicked
6. **New tab or popup opened** — verify which tab is active before continuing
7. **Modal or overlay appeared unexpectedly** — dismiss before attempting target action

---

## Pre-Action Checklist (7 items)

Before EVERY browser action, mentally verify:

- [ ] I took a snapshot (accessibility tree, not just screenshot)
- [ ] I found the target element and verified its text/role
- [ ] I checked surrounding elements confirm correct page section
- [ ] I am on the expected page (URL matches)
- [ ] No modals or overlays are blocking the target
- [ ] I know what the expected state change is after the action
- [ ] I have a recovery plan if the action fails

---

## Learned Patterns

| Date | Site | Issue | Root Cause | Recovery |
|------|------|-------|------------|----------|
| 2026-03-04 | NotebookLM | Clicked "+ Create notebook" instead of "Add source" | Generic "+" icon, did not verify Sources tab was active | ALWAYS click Sources tab first, verify tab is active in snapshot before looking for "Add source" |
