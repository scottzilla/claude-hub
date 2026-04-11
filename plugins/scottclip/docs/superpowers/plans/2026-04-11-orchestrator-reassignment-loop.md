# Orchestrator Reassignment Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the orchestrator automatically spawn the next persona worker when a sub-agent reassigns an issue, with max 3 hops before escalating.

**Architecture:** Expand the orchestrator agent's dispatch section from one-shot to a loop. After each persona-worker sub-agent returns, the orchestrator re-reads issue state, classifies the outcome, and either exits or spawns the next persona. A new reference doc holds detection heuristics.

**Tech Stack:** Markdown only — no TypeScript changes.

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `agents/orchestrator.md` | Modify | Add reassignment loop to Dispatch + After sub-agents return sections |
| `references/reassignment-detection.md` | Create | Detection heuristics, outcome classification, examples |

No changes to: `webhook.ts`, `spawn.ts`, `persona-worker.md`, `comment-format.md`, `heartbeat/SKILL.md`

---

### Task 1: Create reassignment detection reference doc

**Files:**
- Create: `references/reassignment-detection.md`

- [ ] **Step 1: Create the reference doc**

```markdown
# Reassignment Detection

After a persona-worker sub-agent returns, the orchestrator must classify the outcome. This reference defines the detection heuristics.

## Detection Signals (Priority Order)

### 1. Sub-Agent Return Value (Primary)

The persona-worker returns a structured summary including `Final state`. Check this first:

| Return state | Outcome |
|-------------|---------|
| `Done` | **Done** — log and move on |
| `In Review` | **Check for reassignment** — may be human review OR another persona reviewing. Check comment + labels before deciding |
| `Blocked` | **Blocked** — escalate to Board |
| `Reassigned` | **Reassigned** — extract target role, spawn next persona |
| `In Progress` | **Ambiguous** — sub-agent may have hit turn limit without finishing |

### 2. Comment Signal (Confirmation)

Re-fetch issue comments via `mcp__linear-agent__linear_list_comments`. Parse the latest ScottClip comment for:

- `**Status:** Reassigned → {role-name}` — confirms reassignment and names the target role
- `**Status:** Completed` — confirms done
- `**Status:** Blocked` — confirms blocked

The comment is the source of truth for the **target role name** when reassigned.

### 3. Label State (Validation)

Re-fetch issue via `mcp__linear-agent__linear_get_issue`. Compare current labels against the persona label that was active when the sub-agent was spawned:

- **Different persona label** — sub-agent already swapped the label (good)
- **Same persona label** — sub-agent may have forgotten to swap (check comment for target role)
- **No persona label** — sub-agent removed label but didn't add new one (check comment)

## Outcome Classification

| Outcome | How to detect | Action |
|---------|--------------|--------|
| **Done** | Return state = Done, AND no reassignment signal in comments/labels | Log, exit loop for this issue |
| **In Review (check)** | Return state = In Review | Check comment + labels: if reassignment signal found → treat as Reassigned; if label unchanged and no handoff comment → exit loop (human/external review) |
| **Reassigned** | Return state = Reassigned, OR comment contains `Reassigned →` | Extract target role, fix label if needed, spawn next persona |
| **Blocked** | Return state = Blocked, OR issue state = Blocked | Escalate to Board, exit loop |
| **Ambiguous** | Return state = In Progress, no reassignment signal | Read latest comment + issue context, decide: if work seems incomplete and a handoff is implied, treat as reassignment; otherwise, leave issue in current state for next heartbeat |

## Label Correction

If the sub-agent posted a reassignment comment naming a target role but did NOT update the label:

1. Parse target role from comment: match `Reassigned → (\w+)` pattern
2. Validate role exists in `.scottclip/config.yaml` → `roles.labels`
3. If valid: read-modify-write labels (get current → remove old persona label → add new → save full set via `mcp__linear-agent__linear_save_issue`)
4. If invalid: escalate to Board — post comment: `⚠️ Reassignment target "{role-name}" not found in config. Escalating.`

## Examples

### Happy path — CTO reassigns to Quant

Sub-agent returns:
```
Issue: TRAA-43 — Implement rate limit handler
Final state: Reassigned
```

Latest comment:
```
**Status:** Reassigned → quant

### Handoff context
Rate limit logic implemented. Needs quant to validate the backoff parameters against historical data.
```

Labels: `quant` (sub-agent already swapped from `cto`)

→ Outcome: **Reassigned** to `quant`. Label correct. Spawn quant persona-worker.

### Label not updated

Sub-agent returns `Reassigned` but labels still show `cto`.
Comment says `Reassigned → quant`.

→ Orchestrator fixes label: remove `cto`, add `quant`, save. Then spawn.

### Ambiguous — sub-agent hit turn limit

Sub-agent returns:
```
Final state: In Progress
```

No reassignment comment. Issue still has `backend` label.

→ Outcome: **Ambiguous**. Leave in current state. Next heartbeat will pick it up.
```

- [ ] **Step 2: Verify the file is valid markdown**

Run: `head -5 references/reassignment-detection.md`
Expected: Shows the `# Reassignment Detection` header.

- [ ] **Step 3: Commit**

```bash
git add references/reassignment-detection.md
git commit -m "docs(scottclip): add reassignment detection reference"
```

---

### Task 2: Expand orchestrator dispatch section into a loop

**Files:**
- Modify: `agents/orchestrator.md:98-120`

- [ ] **Step 1: Read current orchestrator.md to confirm line numbers**

Read `agents/orchestrator.md` in full. Confirm the Dispatch section starts at line 98 and "After all sub-agents return" ends at line 120.

- [ ] **Step 2: Replace the Dispatch section (lines 98-120)**

Replace the entire `## Dispatch` section and `### After all sub-agents return` subsection with the following. Use the Edit tool to replace from `## Dispatch` through the end of `3. Release lockfile`.

```markdown
## Dispatch

After triage, dispatch work to persona sub-agents. Do not do persona work yourself.

### For each ready issue (post-triage):

1. Resolve persona label → `.scottclip/personas/{persona_name}/`
2. Read `config.yaml` from that directory → extract `runtime.model`, `runtime.thinking_effort`
3. Record the current persona label as `original_persona` (needed for reassignment detection)
4. Initialize `hop_count = 0` for this issue
5. Spawn `persona-worker` sub-agent:
   - `subagent_type`: `"persona-worker"`
   - `model`: from persona config
   - `isolation`: `"worktree"`
   - Include in prompt: `$AGENT_HOME`, thinking effort, issue ID, title, description, recent comments, `agentSessionId` (from your spawn prompt, for Linear activity reporting)

### Parallel dispatch

Spawn all sub-agents in a single message for concurrent execution. Multiple issues with the same persona label spawn multiple sub-agents.

> **Note:** The reassignment loop below runs per-issue AFTER the initial parallel dispatch completes. Each issue's loop is independent.

### After each sub-agent returns — Reassignment Loop

For each completed sub-agent, run the reassignment loop. Read `${CLAUDE_PLUGIN_ROOT}/references/reassignment-detection.md` for detection heuristics.

**Loop procedure:**

1. **Read the sub-agent's return value.** Extract `Final state` from the structured summary.

2. **Classify the outcome:**
   - `Done` → **exit loop** for this issue. Log result.
   - `In Review` → re-fetch issue comments and labels. If reassignment signal found (comment contains `Reassigned →` or label changed to different persona), treat as Reassigned → continue to step 3. Otherwise **exit loop** (external/human review).
   - `Blocked` → **exit loop**. Verify issue is in Blocked state. Log result.
   - `Reassigned` → continue to step 3.
   - `In Progress` (ambiguous) → re-fetch issue comments. If latest ScottClip comment contains `Reassigned →`, treat as Reassigned. Otherwise, **exit loop** — leave issue for next heartbeat.

3. **Check hop count.** Increment `hop_count` by 1.
   - If `hop_count >= 3`: escalation. Post comment on the issue:
     ```
     ⚠️ Issue reassigned 3 times in one dispatch cycle. This may indicate unclear ownership or scope. Escalating to Board.
     ```
     Move issue to Blocked state. @-mention Board user (from `config.yaml` → `linear.user_name`). **Exit loop.**

4. **Extract target role.** Parse the latest ScottClip comment for `Reassigned → {role-name}`. If no comment signal, check if label changed from `original_persona`.

5. **Validate target role.** Check that the target role exists in `.scottclip/config.yaml` → `roles.labels`.
   - If not found: post comment `⚠️ Reassignment target "{role-name}" not found in config. Escalating.` Move to Blocked. @-mention Board user. **Exit loop.**

6. **Fix label if needed.** Re-fetch issue labels. If the persona label does not match the target role, do a read-modify-write: remove old persona label, add target role label, save full set via `mcp__linear-agent__linear_save_issue`.

7. **Spawn next persona-worker.** Resolve the new persona directory, read its `config.yaml`, and spawn a new `persona-worker` sub-agent (same parameters as initial dispatch, but with updated persona).

8. **Wait for completion.** When the sub-agent returns, **loop back to step 1.**

### After all issues complete

1. Check results for any remaining escalations
2. Log aggregate heartbeat to `.scottclip/heartbeat-log.jsonl`
3. Release lockfile
```

- [ ] **Step 3: Verify the edit**

Read `agents/orchestrator.md` in full. Confirm:
- Dispatch section starts with `## Dispatch`
- Contains "Reassignment Loop" subsection
- "After all issues complete" replaces old "After all sub-agents return"
- Rules section (line 122+) is unchanged

- [ ] **Step 4: Commit**

```bash
git add agents/orchestrator.md
git commit -m "feat(scottclip): add post-dispatch reassignment loop to orchestrator"
```

---

### Task 3: Verify references are accessible from orchestrator

**Files:**
- Modify: `agents/orchestrator.md` (minor — add reference read instruction)

- [ ] **Step 1: Add reference read to Setup section**

In the orchestrator's `## Setup` section (currently just two items), add a third item after the existing two:

```markdown
3. Read `${CLAUDE_PLUGIN_ROOT}/references/reassignment-detection.md` — reassignment detection heuristics for the post-dispatch loop
```

- [ ] **Step 2: Verify the edit**

Read `agents/orchestrator.md` lines 1-35. Confirm Setup now has 3 items.

- [ ] **Step 3: Commit**

```bash
git add agents/orchestrator.md
git commit -m "chore(scottclip): add reassignment-detection reference to orchestrator setup"
```

---

### Task 4: Verify word count and trim if needed

**Files:**
- Check: `agents/orchestrator.md`

CLAUDE.md says SKILL.md body target is 1,500-2,000 words. Agent files don't have the same limit but should stay focused.

- [ ] **Step 1: Count words**

Run: `wc -w agents/orchestrator.md`

- [ ] **Step 2: If over ~2,500 words, trim**

The dispatch section is the most verbose. If the word count is too high, move the detailed loop procedure steps (the 8-step procedure) into `references/reassignment-detection.md` and replace with a compact summary + reference pointer in orchestrator.md.

If under ~2,500 words, no action needed.

- [ ] **Step 3: Commit if changes were made**

```bash
git add agents/orchestrator.md references/reassignment-detection.md
git commit -m "refactor(scottclip): trim orchestrator, move loop details to reference"
```

---

### Task 5: Final validation

- [ ] **Step 1: Verify all YAML/markdown parses cleanly**

Run:
```bash
head -5 agents/orchestrator.md
head -5 references/reassignment-detection.md
head -5 references/comment-format.md
```

Confirm frontmatter is intact on orchestrator.md (should start with `---`).

- [ ] **Step 2: Verify cross-references resolve**

Check that these paths exist:
- `references/reassignment-detection.md` — new file
- `references/comment-format.md` — existing
- `references/label-conventions.md` — existing
- `references/status-mapping.md` — existing

Run: `ls references/`

- [ ] **Step 3: Read orchestrator.md end-to-end**

Read the full file. Check:
- No placeholders or TODOs
- Dispatch section flows: initial spawn → reassignment loop → exit conditions → cleanup
- Rules section is unchanged
- Setup references all needed docs

- [ ] **Step 4: Verify git status is clean**

Run: `git status`
Expected: clean working tree, all changes committed.
