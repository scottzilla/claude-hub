# State-Driven Label Assignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor ScottClip so Linear workflow states drive issue lifecycle and labels are used exclusively for persona assignment.

**Architecture:** Remove `agent-working` and `agent-blocked` labels. Use Linear state transitions (Todo → In Progress → Blocked → In Review → Done) for all status tracking. Persona labels remain the sole label type. All state transitions happen via `save_issue` with the state field.

**Tech Stack:** Markdown, YAML (no runtime code — this is a Claude Code plugin)

**Spec:** `docs/superpowers/specs/2026-04-02-state-driven-label-assignment-design.md`

---

### Task 1: Rewrite `references/status-mapping.md`

Skills reference this file for state transition rules. Update it first so all downstream changes are consistent.

**Files:**
- Modify: `references/status-mapping.md`

- [ ] **Step 1: Replace the full content of `references/status-mapping.md`**

```markdown
# Status Mapping

Maps between Linear issue states and ScottClip agent behavior. Linear states are the single source of truth for issue lifecycle.

## Linear States → ScottClip Behavior

| Linear State | ScottClip Behavior |
|-------------|-------------------|
| **Backlog** | Ignored — not in the inbox |
| **Todo** | In the inbox, eligible for pickup (lower priority than In Progress) |
| **In Progress** | In the inbox for resume; agent is actively working |
| **Blocked** | Skipped unless new human comments exist since last agent comment |
| **In Review** | Ignored — human is reviewing, agent should not touch |
| **Done** | Ignored — completed |
| **Canceled** | Ignored — canceled |

## State Transitions

| Trigger | From State | To State | Actor |
|---------|-----------|----------|-------|
| Heartbeat picks up issue | Todo | In Progress | Agent |
| Work completed, agent confident | In Progress | Done | Agent |
| Work completed, wants human check | In Progress | In Review | Agent |
| Work completed, needs another persona | In Progress | Todo (+ swap persona label) | Agent |
| Agent is blocked | In Progress | Blocked | Agent |
| Human unblocks issue | Blocked | Todo | Human |
| Human approves review | In Review | Done | Human |
| Human requests changes | In Review | Todo | Human |

All state transitions use `mcp__claude_ai_Linear__save_issue` with the target state name.

## Inbox Query

The heartbeat fetches all issues assigned to "me" (resolved dynamically by Linear MCP), then filters client-side:

### Sort Order

1. **Status**: In Progress > Todo (all others filtered out)
2. **Priority**: Urgent > High > Medium > Low > No priority

### Filter Rules

- Skip issues without a persona label (unless Orchestrator is default)
- Skip Blocked issues unless new human comments exist since last agent comment
- Skip issues in states other than Todo or In Progress
- If `--persona <name>` flag is set, only match that persona's label

## Stale Detection

- "In Progress" state with no heartbeat comment in the last `stale_lock_hours` → stale
- Heartbeat cleans stale issues: moves to Todo, posts a comment explaining the cleanup
```

- [ ] **Step 2: Validate the file is well-formed markdown**

Visually confirm: no broken tables, no orphaned references to `agent-working` or `agent-blocked`.

- [ ] **Step 3: Commit**

```bash
git add references/status-mapping.md
git commit -m "docs: rewrite status-mapping for state-driven lifecycle

Replace label-based status tracking with Linear workflow state
transitions. States are now the single source of truth for issue
lifecycle."
```

---

### Task 2: Rewrite `references/label-conventions.md`

Simplify to persona-assignment-only labels.

**Files:**
- Modify: `references/label-conventions.md`

- [ ] **Step 1: Replace the full content of `references/label-conventions.md`**

```markdown
# Label Conventions

ScottClip uses Linear labels exclusively for persona assignment — routing issues to the right agent persona.

**Labels = who owns the issue. States = where it is in the lifecycle.**

## Label Group

All ScottClip labels live under a parent group (default: `ScottClip`). The group name is configurable in `config.yaml` → `labels.group`.

## Persona Labels

Persona labels route issues to the right persona. Created by `/scottclip-init`.

| Label | Persona | Typical signals |
|-------|---------|-----------------|
| `backend` | Backend Engineer | API, endpoint, route, database, migration, query, webhook |
| `frontend` | Frontend Engineer | Component, UI, page, layout, styling, responsive, animation |
| `infra` | Infra Engineer | Deploy, CI/CD, Docker, env vars, infrastructure |
| `qa` | QA Engineer | Test, coverage, E2E, integration test, flaky |
| `ceo` | CEO | Strategy, prioritization, roadmap, architecture, cross-cutting |
| *(none)* | Orchestrator (default) | Unlabeled issues — routed by the Orchestrator |

### Persona Label Rules

- **One persona label per issue.** Never dual-label — decompose into sub-issues instead.
- Labels are applied by the Orchestrator during triage, or manually by the Board.
- Custom persona labels are added via `/persona-create` and registered in `config.yaml`.

## Label Lifecycle

```
New issue (no labels)
  → Orchestrator triages → adds persona label (e.g., "backend")
  → Heartbeat picks up → state moves to In Progress (no label change)
  → Work completes → state moves to Done/In Review (no label change)
  → Or blocked → state moves to Blocked (no label change)
  → Or reassigned → persona label swapped, state moves to Todo
```

## Reassignment

When an agent hands off to another persona:

1. Read current labels via `get_issue`
2. Remove own persona label, add target persona label
3. Save the full label set via `save_issue`
4. Move state to Todo (in the same `save_issue` call)
5. Post a handoff comment explaining what the next persona needs to do

## Read-Modify-Write Pattern

Linear labels are managed as arrays. To change a persona label:

1. `get_issue` — read current labels array
2. Modify the array (swap persona labels)
3. `save_issue` — save the full label set

This is safe because ScottClip runs as a single instance per repo — no concurrent writers.
```

- [ ] **Step 2: Validate no references to `agent-working` or `agent-blocked` remain**

Search the file for "agent-working" and "agent-blocked" — neither should appear.

- [ ] **Step 3: Commit**

```bash
git add references/label-conventions.md
git commit -m "docs: simplify label-conventions to persona-only labels

Remove agent-working and agent-blocked label documentation. Labels
are now used exclusively for persona assignment. Issue status is
tracked via Linear workflow states."
```

---

### Task 3: Update `references/comment-format.md` with reassignment template

**Files:**
- Modify: `references/comment-format.md`

- [ ] **Step 1: Add a reassignment template after the Blocked Template section**

Insert the following after the "Blocked Template" section (after line 47, before the "Rules" section):

```markdown
## Reassignment Template

```markdown
## Heartbeat #N — YYYY-MM-DD HH:MM UTC (duration)

**Status:** Reassigned → persona-name

### What was done
- Work completed before handoff

### Handoff context
What the next persona needs to know and do.

### Why reassigning
Reason this work belongs to the other persona.

---
*ScottClip · original-persona-name · [WOT-XX](link) · from [Heartbeat #N-1](link)*
```
```

- [ ] **Step 2: In the Rules section, add a rule for reassignment comments**

Add this line to the Rules section:

```
- Reassignment comments must explain what was done, what the next persona needs to do, and why the handoff is happening
```

- [ ] **Step 3: Commit**

```bash
git add references/comment-format.md
git commit -m "docs: add reassignment comment template

New template for when agents hand off issues to another persona,
documenting what was done and what the next persona needs."
```

---

### Task 4: Update `templates/config.yaml` — remove state label config

**Files:**
- Modify: `templates/config.yaml`

- [ ] **Step 1: Remove the `working` and `blocked` keys from the labels section**

Replace lines 30-33:
```yaml
# Linear label configuration
labels:
  group: "ScottClip"                 # Parent label group (auto-created by init)
  working: "agent-working"           # Applied while agent is working an issue
  blocked: "agent-blocked"           # Applied when agent is blocked
```

With:
```yaml
# Linear label configuration
labels:
  group: "ScottClip"                 # Parent label group for persona labels (auto-created by init)
```

- [ ] **Step 2: Validate YAML parses cleanly**

Run: `python3 -c "import yaml; yaml.safe_load(open('templates/config.yaml'))"`
Expected: no output (success)

- [ ] **Step 3: Commit**

```bash
git add templates/config.yaml
git commit -m "config: remove working/blocked label keys

State labels are replaced by Linear workflow states. Only the
label group name remains for persona label organization."
```

---

### Task 5: Rewrite `skills/heartbeat/SKILL.md` — state-driven lifecycle

This is the core change. The heartbeat skill needs to use state transitions instead of label mutations for status tracking.

**Files:**
- Modify: `skills/heartbeat/SKILL.md`

- [ ] **Step 1: Update Step 2 (Check Inbox) — remove label-based filtering, add state-based filtering**

Replace Step 2 (lines 36-44) with:

```markdown
## Step 2: Check Inbox

1. Call `mcp__claude_ai_Linear__list_issues` with filter for assigned issues (`assignee: "me"`).
2. Filter client-side:
   - **Keep** only issues with status "In Progress" or "Todo"
   - **Skip** issues without a persona label (unless Orchestrator is default and issue has no label)
   - **Skip** "Blocked" issues unless new human comments exist since the last agent comment (check via `mcp__claude_ai_Linear__list_comments`)
3. Sort:
   - Primary: status — In Progress before Todo
   - Secondary: priority — Urgent > High > Medium > Low > None
4. Detect stale "In Progress" issues: if an issue is "In Progress" but has no heartbeat comment within `stale_lock_hours`, move it to "Todo" via `mcp__claude_ai_Linear__save_issue` and post a cleanup comment.
```

- [ ] **Step 2: Update Step 5 (Validate Tools) — remove label references**

Replace Step 5 (lines 76-83) with:

```markdown
## Step 5: Validate Tools

Read `required_tools` from persona config. For each entry, verify the tool prefix is available:
- `mcp__claude_ai_Linear` should match any tool starting with `mcp__claude_ai_Linear__`
- If a required tool prefix has **no matching tools** available → stop work on this issue immediately
  - Post a blocked comment naming the missing tool
  - Move issue to "Blocked" state via `mcp__claude_ai_Linear__save_issue`
  - Proceed to step 11 (next issue)
```

- [ ] **Step 3: Update Step 6 (Lock Issue) — transition to In Progress state instead of adding label**

Replace Step 6 (lines 85-89) with:

```markdown
## Step 6: Claim Issue

1. Call `mcp__claude_ai_Linear__get_issue` to read the issue's current state.
2. If the issue is already "In Progress" (resuming interrupted work), proceed without state change.
3. If the issue is "Todo", transition to "In Progress" via `mcp__claude_ai_Linear__save_issue`.
```

- [ ] **Step 4: Update Step 8 (Do Work) — remove label reference for mid-work failure**

Replace the "If Linear MCP becomes unavailable mid-work" paragraph (line 112) with:

```markdown
**If Linear MCP becomes unavailable mid-work:** Stop immediately. The issue stays "In Progress" (will be detected as stale on next heartbeat if not resumed). Delete lockfile and exit with error log.
```

- [ ] **Step 5: Update Step 10 (Update State) — use state transitions instead of label mutations**

Replace Step 10 (lines 131-141) with:

```markdown
## Step 10: Update State

Transition the issue's Linear state based on outcome. Use `mcp__claude_ai_Linear__save_issue` for all transitions.

| Outcome | State Transition | Label Change |
|---------|-----------------|--------------|
| **Completed (confident)** | In Progress → Done | None |
| **Completed (needs review)** | In Progress → In Review | None |
| **Reassign to another persona** | In Progress → Todo | Swap persona label (remove own, add target) |
| **Blocked** | In Progress → Blocked | None |
| **More work needed** | Stay In Progress | None |

**Completion judgment** — decide which path based on context:
- **Done** — work is complete, tests pass, no ambiguity, low risk
- **In Review** — code changes that affect users, architectural decisions, risk involved
- **Reassign** — out of scope for this persona, needs different expertise or approval

For blocked issues: include the Board user's display name in the comment text (e.g., "**@Alex Kim** — please review").

For reassignment: post a handoff comment (see `${CLAUDE_PLUGIN_ROOT}/references/comment-format.md` reassignment template) explaining what was done and what the next persona needs to do.
```

- [ ] **Step 6: Validate no references to `agent-working` or `agent-blocked` remain in the file**

Search the file for "agent-working" and "agent-blocked" — neither should appear.

- [ ] **Step 7: Validate SKILL.md frontmatter is intact**

Confirm the `---` delimited frontmatter at the top still has `name` and `description` fields.

- [ ] **Step 8: Commit**

```bash
git add skills/heartbeat/SKILL.md
git commit -m "feat: heartbeat uses Linear state transitions instead of labels

Replace agent-working/agent-blocked label mutations with Linear
workflow state transitions. Agent moves issues between Todo,
In Progress, Blocked, In Review, and Done. Adds completion
judgment (Done vs In Review vs Reassign)."
```

---

### Task 6: Update `skills/init/SKILL.md` — remove state label creation

**Files:**
- Modify: `skills/init/SKILL.md`

- [ ] **Step 1: Update Step 3 (Create Linear Labels) — remove state label creation**

Replace Step 3 (lines 46-56) with:

```markdown
### Step 3: Create Linear Labels

Create the ScottClip label group and persona labels in Linear:

1. Call `mcp__claude_ai_Linear__create_issue_label` to create the parent group label named after `labels.group` (default: "ScottClip")
2. Create child labels under this group:
   - One label per persona that has a non-null label (e.g., `backend`, `frontend`)

Use `mcp__claude_ai_Linear__list_issue_labels` first to check if labels already exist. Skip creation for any label that already exists.

**Important:** The Linear MCP's `create_issue_label` accepts `name`, `color`, and optionally `parentId` (for grouping under a parent label). Fetch the parent group label's ID after creating it, then pass it as `parentId` for child labels.
```

- [ ] **Step 2: Update Step 6 (Print Summary) — remove state labels from output**

Replace the summary output (lines 105-123) with:

```markdown
Display what was created:

```
ScottClip initialized!

Linear labels created:
  ✓ ScottClip (group)
  ✓ backend
  ✓ frontend

Config: .scottclip/config.yaml
Personas:
  ✓ orchestrator → default (no label)
  ✓ ceo          → "ceo" label
  ✓ backend      → "backend" label
  ✓ frontend     → "frontend" label

Next steps:
  1. Review .scottclip/config.yaml
  2. Customize persona SOUL.md files for your project
  3. Run /heartbeat or /schedule 30m /heartbeat
```
```

- [ ] **Step 3: Commit**

```bash
git add skills/init/SKILL.md
git commit -m "feat: init only creates persona labels, not state labels

Remove creation of agent-working and agent-blocked labels during
initialization. Only persona labels are created under the ScottClip
group."
```

---

### Task 7: Update `skills/status/SKILL.md` — query by state

**Files:**
- Modify: `skills/status/SKILL.md`

- [ ] **Step 1: Update Step 4 (Current Issues) — filter by state instead of labels**

Replace Step 4 (lines 35-50) with:

```markdown
### Step 4: Current Issues

Call `mcp__claude_ai_Linear__list_issues` with `assignee: "me"`. Filter and categorize by Linear state:

**Since last heartbeat** (issues that changed since the last logged heartbeat timestamp):
- `✓` Done issues (completed)
- `→` In Progress issues (actively being worked)
- `⏸` In Review issues (awaiting human review)
- `✗` Blocked issues
- `+` Newly created sub-issues

**Queue** (next heartbeat would pick these up):
- Issues with persona labels, status Todo or In Progress, sorted by priority
- Show: issue ID, persona label, status, priority, title

**Blocked** (needs Board attention):
- Issues in "Blocked" state
- Show: issue ID, Board user mention, blocker summary from last agent comment
```

- [ ] **Step 2: Update Step 5 (Format Output) — reflect state-based categories**

Replace the format output (lines 52-68) with:

```markdown
### Step 5: Format Output

```
ScottClip Status
────────────────
Last beat:    Heartbeat #N — X min ago

Since last heartbeat:
  ✓ WOT-XX  [persona]   Done         "Title"
  → WOT-XX  [persona]   In Progress  "Title"
  ⏸ WOT-XX  [persona]   In Review    "Title"
  ✗ WOT-XX  [persona]   Blocked      "Title"

Queue (next heartbeat):
  WOT-XX  [persona]  Status  Priority  "Title"

Blocked (needs Board):
  WOT-XX  @User — blocker summary
```
```

- [ ] **Step 3: Commit**

```bash
git add skills/status/SKILL.md
git commit -m "feat: status displays use Linear states instead of labels

Filter and categorize issues by Linear workflow state (Done,
In Progress, In Review, Blocked) instead of agent-working/
agent-blocked labels."
```

---

### Task 8: Add completion judgment to persona SOUL.md templates

**Files:**
- Modify: `templates/personas/orchestrator/SOUL.md`
- Modify: `templates/personas/ceo/SOUL.md`
- Modify: `templates/personas/backend/SOUL.md`
- Modify: `templates/personas/frontend/SOUL.md`

- [ ] **Step 1: Add completion judgment section to Backend SOUL.md**

Add before the "Quality Checklist" section (before line 37):

```markdown
## Completion Judgment

When work is done, decide the right completion path:

- **Done** — code compiles, tests pass, change is straightforward and low risk. Move state to Done.
- **In Review** — code changes affect users, touch shared infrastructure, or involve non-obvious trade-offs. Move state to In Review for human verification.
- **Reassign** — hit a problem outside your domain (frontend issue, architectural question, strategic decision). Swap persona label to the right owner, move state to Todo, post a handoff comment explaining context.

When in doubt between Done and In Review, prefer In Review.
```

- [ ] **Step 2: Add completion judgment section to Frontend SOUL.md**

Add before the "Quality Checklist" section (before line 37):

```markdown
## Completion Judgment

When work is done, decide the right completion path:

- **Done** — component renders correctly, responsive, accessible, no console errors. Move state to Done.
- **In Review** — UI changes affect user-facing flows, touch shared components, or involve design judgment calls. Move state to In Review for human verification.
- **Reassign** — hit a backend issue, need API changes, or have an architectural question. Swap persona label to the right owner, move state to Todo, post a handoff comment.

When in doubt between Done and In Review, prefer In Review.
```

- [ ] **Step 3: Add completion judgment section to CEO SOUL.md**

Add before the "Quality Checklist" section (before line 49):

```markdown
## Completion Judgment

When a decision is made, decide the right completion path:

- **Done** — decision is documented, affected issues updated, clear and unambiguous. Move state to Done.
- **In Review** — significant direction change, budget/scope implications, or the Board should weigh in before teams act on it. Move state to In Review.
- **Reassign** — decision reveals work for a specific persona. Create or update issues with the right persona labels, move state to Todo.

Default to Done for routine decisions. Use In Review for one-way doors.
```

- [ ] **Step 4: Add completion judgment section to Orchestrator SOUL.md**

Add before the "Voice" section (before line 32):

```markdown
## Completion Judgment

After triage, decide the right completion path:

- **Done** — issue is routed (persona label applied) or decomposed (sub-issues created). Move state to Done.
- **Reassign** — if during triage you realize an issue needs a different persona than initially labeled, swap the label and move to Todo.

Orchestrator work is almost always Done after triage. Use Blocked state only when you cannot determine routing and need Board clarification.
```

- [ ] **Step 5: Commit**

```bash
git add templates/personas/*/SOUL.md
git commit -m "feat: add completion judgment guidance to all persona SOULs

Each persona now has guidance on when to mark Done, move to
In Review, or reassign to another persona. Replaces implicit
label-based status with explicit state transition decisions."
```

---

### Task 9: Update `agents/orchestrator.md` — reflect state-driven model

**Files:**
- Modify: `agents/orchestrator.md`

- [ ] **Step 1: Update triage actions to use state transitions**

In the "Decide" table (line 44-51), replace the "Unclear scope" row:

Replace:
```
| **Unclear scope** | Apply `agent-blocked`, @-mention Board user, ask for clarification |
```

With:
```
| **Unclear scope** | Move to Blocked state, @-mention Board user, ask for clarification |
```

- [ ] **Step 2: Update the Parent Completion Check section**

Replace "close the parent issue" (line 87) with language about moving the parent to Done state:

Replace:
```
When working on a sub-issue that just completed, check if all sibling sub-issues are also done. If so, close the parent issue with a summary comment listing all completed sub-issues.
```

With:
```
When working on a sub-issue that just completed, check if all sibling sub-issues are also done. If so, move the parent issue to Done state with a summary comment listing all completed sub-issues.
```

- [ ] **Step 3: Commit**

```bash
git add agents/orchestrator.md
git commit -m "feat: orchestrator uses state transitions for triage outcomes

Replace agent-blocked label with Blocked state. Use Done state
for parent completion."
```

---

### Task 10: Update `CLAUDE.md` — architecture description

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update the "Key conventions" section**

Replace the labels convention bullet (the line starting with "**Labels are the state machine.**"):

Replace:
```
- **Labels are the state machine.** `agent-working` and `agent-blocked` are mutually exclusive. Labels are managed via read-modify-write (get labels array → modify → save full set).
```

With:
```
- **Labels = who, States = what.** Persona labels (`backend`, `frontend`, `ceo`) indicate which agent owns an issue. Linear workflow states (Todo → In Progress → Blocked → In Review → Done) track lifecycle. No status labels — states are the single source of truth. Labels are managed via read-modify-write (get labels array → modify → save full set).
```

- [ ] **Step 2: Validate no references to `agent-working` or `agent-blocked` remain in CLAUDE.md**

Search the file for "agent-working" and "agent-blocked" — neither should appear.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for state-driven architecture

Replace label-based state machine description with labels=who,
states=what convention."
```
