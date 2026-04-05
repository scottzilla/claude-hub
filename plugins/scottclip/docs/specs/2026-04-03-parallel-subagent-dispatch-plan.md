# Parallel Sub-Agent Dispatch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable the orchestrator to dispatch persona sub-agents in parallel via the Agent tool, each in its own git worktree.

**Architecture:** Single generic `persona-worker` agent reads SOUL.md/TOOLS.md from `$AGENT_HOME` at startup. Orchestrator reads persona config.yaml for spawn-time settings (model, thinking_effort), then issues parallel Agent calls. Each sub-agent owns its Linear state updates.

**Tech Stack:** Markdown, YAML (no runtime code)

---

### Task 1: Create `agents/persona-worker.md`

**Files:**
- Create: `agents/persona-worker.md`

- [ ] **Step 1: Create the persona-worker agent definition**

```markdown
---
description: Executes work as a ScottClip persona. Reads identity from $AGENT_HOME (SOUL.md, TOOLS.md, config.yaml) and works a single Linear issue. Owns all Linear state updates for the assigned issue.
tools:
  - mcp__claude_ai_Linear__list_issues
  - mcp__claude_ai_Linear__get_issue
  - mcp__claude_ai_Linear__save_issue
  - mcp__claude_ai_Linear__save_comment
  - mcp__claude_ai_Linear__list_issue_labels
  - mcp__claude_ai_Linear__list_comments
  - mcp__claude_ai_Linear__create_issue_label
  - Read
  - Write
  - Edit
  - Bash
  - Grep
  - Glob
---

# Persona Worker

Execute work on a single Linear issue as a ScottClip persona.

## Startup

1. Parse the `$AGENT_HOME` path from your spawn prompt. This is the persona directory (e.g., `.scottclip/personas/backend`).
2. Read `$AGENT_HOME/SOUL.md` — adopt this as your identity. Follow it exactly.
3. Read `$AGENT_HOME/TOOLS.md` — these are your tool constraints. Only use tools described there.
4. Read `$AGENT_HOME/config.yaml` — respect `max_turns` as your work budget.
5. Read `${CLAUDE_PLUGIN_ROOT}/references/comment-format.md` — follow this format for all Linear comments.
6. Read `${CLAUDE_PLUGIN_ROOT}/references/label-conventions.md` — follow label rules.
7. Read `${CLAUDE_PLUGIN_ROOT}/references/status-mapping.md` — follow state transition rules.

## Work

1. Parse the issue context from your spawn prompt (issue ID, title, description, comments).
2. Follow your SOUL.md instructions to do the work.
3. Respect the `thinking_effort` level specified in your spawn prompt.
4. Track your turn count against `max_turns` from config.yaml. When approaching the limit, wrap up and report.

## Report

After completing work (or hitting budget), post a structured comment on the Linear issue:

1. Parse heartbeat counter from existing comments (find last `Heartbeat #N`, increment).
2. Post comment following `${CLAUDE_PLUGIN_ROOT}/references/comment-format.md`.
3. Update issue state per `${CLAUDE_PLUGIN_ROOT}/references/status-mapping.md`.

## Return

Return a summary to the orchestrator containing:
- Issue ID and title
- Final state (Done, In Review, Blocked, In Progress, Reassigned)
- Commits made (if any)
- Sub-issues created (if any)
- Escalation flag (if blocked or needs Board attention)

## Worktree Awareness

You are running in a git worktree. The repo may contain docs, specs, and plugin files you did not author. This is normal — treat them as part of the repo. Include them in commits and merges as needed.

## Rules

- You work ONE issue. Do not pick up additional issues.
- You own Linear state updates for your issue. Do not wait for the orchestrator.
- If a required tool is unavailable, stop immediately and return with an escalation flag.
- If Linear MCP becomes unavailable mid-work, stop and return with an error summary.
```

- [ ] **Step 2: Validate frontmatter**

Run: `python3 -c "import yaml; data = yaml.safe_load(open('agents/persona-worker.md').read().split('---')[1]); print('description:', data.get('description', 'MISSING')[:50], '...'); print('tools:', len(data.get('tools', []))); assert data.get('description'); assert data.get('tools')"`
Expected: description and tools count printed, no assertion error.

- [ ] **Step 3: Commit**

```bash
git add agents/persona-worker.md
git commit -m "feat: add persona-worker sub-agent definition"
```

---

### Task 2: Update orchestrator TOOLS.md — add Agent tool

**Files:**
- Modify: `templates/personas/orchestrator/TOOLS.md`

- [ ] **Step 1: Add Agent tool section to TOOLS.md**

Add the following after the existing `## Not Used` section, replacing that section:

Replace this:
```markdown
## Not Used

The Orchestrator does not use repo tools (file read/write, git, bash, etc.). It only reads the ScottClip config to understand available personas.
```

With this:
```markdown
## Sub-Agent Dispatch

- **Agent** tool: Spawn persona sub-agents for parallel issue processing.

### Spawning a persona sub-agent

1. Read the persona's `config.yaml` from `$AGENT_HOME` to extract `model` and `thinking_effort`.
2. Call `Agent` with:
   - `subagent_type`: `"persona-worker"`
   - `model`: from persona config.yaml `runtime.model`
   - `isolation`: `"worktree"` (always)
   - `prompt`: spawn prompt containing `$AGENT_HOME`, thinking effort, and issue context

### Spawn prompt template

    $AGENT_HOME = .scottclip/personas/{persona_name}
    Thinking effort: {thinking_effort}

    Issue: {issue_id} - {issue_title}
    Description:
    {issue_description}

    Recent comments:
    {formatted_comments}

### Parallel dispatch

To dispatch multiple sub-agents in parallel, include all Agent calls in a single message. Claude executes them concurrently.

### Collecting results

Each sub-agent returns a summary with: issue ID, final state, commits, sub-issues created, and escalation flag. The orchestrator does NOT update Linear — sub-agents handle their own state transitions.

## Not Used

The Orchestrator does not use repo tools (file read/write, git, bash, etc.) except `Read` for loading persona config.yaml files before dispatch.
```

- [ ] **Step 2: Commit**

```bash
git add templates/personas/orchestrator/TOOLS.md
git commit -m "feat: add Agent tool and dispatch patterns to orchestrator TOOLS"
```

---

### Task 3: Update orchestrator SOUL.md — add dispatch behavior

**Files:**
- Modify: `templates/personas/orchestrator/SOUL.md`

- [ ] **Step 1: Add dispatch section to SOUL.md**

Add the following section after the existing `## Triage Decision Framework` section:

```markdown
## Dispatch

After triage, dispatch work to persona sub-agents rather than doing it yourself.

### Single issue ready

1. Resolve the persona label to its directory (`$AGENT_HOME`).
2. Read `$AGENT_HOME/config.yaml` to get `model` and `thinking_effort`.
3. Spawn one `persona-worker` sub-agent with the issue context.
4. Wait for the sub-agent to return.
5. Check the result for escalations.

### Multiple issues ready

1. Collect all ready issues (up to `max_issues_per_heartbeat`).
2. For each issue, resolve persona and read config.
3. Spawn ALL sub-agents in a single message (parallel execution).
4. Wait for all sub-agents to return.
5. Check all results for escalations.

Multiple issues with the same persona label spawn multiple sub-agents of the same type — each in its own worktree.

### After dispatch

- If any sub-agent flagged an escalation (Blocked, Reassigned), log it in the heartbeat summary.
- Log the aggregate heartbeat to `.scottclip/heartbeat-log.jsonl`.
- The orchestrator does NOT update Linear states — each sub-agent already handled its own.
```

- [ ] **Step 2: Update the Completion Judgment section**

Replace the existing `## Completion Judgment` section with:

```markdown
## Completion Judgment

After dispatch, decide the orchestrator's own completion path:

- **Done** — all sub-agents returned successfully (even if some issues are Blocked — that's the sub-agent's call, not yours).
- **More work** — there are more issues in the inbox beyond `max_issues_per_heartbeat`. Continue to next cycle.

The orchestrator's Linear state updates are limited to triage actions (labeling, decomposing, escalating). Issue work states are owned by sub-agents.
```

- [ ] **Step 3: Commit**

```bash
git add templates/personas/orchestrator/SOUL.md
git commit -m "feat: add dispatch and parallel execution to orchestrator SOUL"
```

---

### Task 4: Update heartbeat SKILL.md — modify steps 8-9

**Files:**
- Modify: `skills/heartbeat/SKILL.md`

- [ ] **Step 1: Replace Step 3 (Pick Issue) with batch collection**

Replace the existing `## Step 3: Pick Issue` section with:

```markdown
## Step 3: Collect Ready Issues

1. If `--persona <name>` flag is set, filter to only issues matching that persona's label.
2. Collect up to `max_issues_per_heartbeat` issues from the sorted inbox.
3. If `--dry-run`, report what would be picked and exit:
   ```
   Dry run — would pick:
     WOT-XX [backend] "Issue title" (In Progress, High)
     WOT-YY [frontend] "Other issue" (Todo, Medium)
   Queue (deferred to next heartbeat):
     WOT-ZZ [backend] "Third issue" (Todo, Low)
   ```
4. If no issues match → delete lockfile and exit: "No issues in queue. Heartbeat complete."
```

- [ ] **Step 2: Replace Step 8 (Do Work) with dispatch**

Replace the existing `## Step 8: Do Work` section with:

```markdown
## Step 8: Dispatch Sub-Agents

For each collected issue, spawn a persona sub-agent:

1. Resolve persona label → persona directory (`$AGENT_HOME = .scottclip/personas/{persona_name}`).
2. Read `$AGENT_HOME/config.yaml` → extract `runtime.model` and `runtime.thinking_effort`.
3. Spawn a `persona-worker` sub-agent via the Agent tool:
   - `subagent_type`: `"persona-worker"`
   - `model`: from persona config
   - `isolation`: `"worktree"`
   - `prompt`: include `$AGENT_HOME`, thinking effort, issue ID, title, description, and recent comments

**Spawn all sub-agents in a single message** to enable parallel execution. Each sub-agent:
- Reads its SOUL.md, TOOLS.md, and config.yaml at startup
- Works the assigned issue following persona instructions
- Posts heartbeat comments and updates Linear state
- Returns a summary to the orchestrator

**If Linear MCP becomes unavailable before dispatch:** Stop immediately. Delete lockfile and exit with error log. Issues stay in their current state (will be detected as stale on next heartbeat if In Progress).
```

- [ ] **Step 3: Replace Step 9 (Report) with collect results**

Replace the existing `## Step 9: Report` section with:

```markdown
## Step 9: Collect Results

After all sub-agents return:

1. Parse each sub-agent's summary for: issue ID, final state, commits, sub-issues created, escalation flag.
2. For any escalations (Blocked, Reassigned), log them for the heartbeat summary.
3. Append aggregate heartbeat metadata to `.scottclip/heartbeat-log.jsonl`:

    {"heartbeat": N, "timestamp": "ISO", "issues_dispatched": N, "results": [{"issue": "WOT-XX", "persona": "name", "status": "done|blocked|in_progress|reassigned", "commits": N, "sub_issues": N}], "duration_sec": N}

Note: Individual issue comments and state transitions are handled by sub-agents in Step 8. The orchestrator does not post per-issue comments.
```

- [ ] **Step 4: Update Step 10 (Update State)**

Replace the existing `## Step 10: Update State` section with:

```markdown
## Step 10: Update State

Issue state transitions are handled by sub-agents during Step 8. The orchestrator does not update individual issue states after dispatch.

If the orchestrator performed triage actions (labeling, decomposing) before dispatch, those state updates happen in Step 8 as part of triage — not here.
```

- [ ] **Step 5: Update Step 11 (Next Issue or Exit)**

Replace the existing `## Step 11: Next Issue or Exit` section with:

```markdown
## Step 11: Next Cycle or Exit

1. If there are remaining issues in the inbox beyond `max_issues_per_heartbeat`, return to **Step 2** for the next batch.
2. Otherwise, delete lockfile and exit.
3. If 0 todo issues remain in queue, suggest pausing the schedule.
4. If 3+ issues are blocked across sub-agent results, suggest Board attention rather than more heartbeats.
```

- [ ] **Step 6: Commit**

```bash
git add skills/heartbeat/SKILL.md
git commit -m "feat: update heartbeat loop for parallel sub-agent dispatch"
```

---

### Task 5: Update orchestrator agent definition — add Agent tool

**Files:**
- Modify: `agents/orchestrator.md`

- [ ] **Step 1: Add Agent and Read tools to orchestrator frontmatter**

In the `tools:` list in the frontmatter, add:

```yaml
  - Agent
```

`Read` is already listed. `Agent` is needed for spawning persona-worker sub-agents.

- [ ] **Step 2: Add dispatch section to orchestrator agent body**

Add the following section after `## Triage Procedure`, before `## Rules`:

```markdown
## Dispatch

After triage, dispatch work to persona sub-agents. Do not do persona work yourself.

### For each ready issue (post-triage):

1. Resolve persona label → `.scottclip/personas/{persona_name}/`
2. Read `config.yaml` from that directory → extract `runtime.model`, `runtime.thinking_effort`
3. Spawn `persona-worker` sub-agent:
   - `subagent_type`: `"persona-worker"`
   - `model`: from persona config
   - `isolation`: `"worktree"`
   - Include in prompt: `$AGENT_HOME`, thinking effort, issue ID, title, description, recent comments

### Parallel dispatch

Spawn all sub-agents in a single message for concurrent execution. Multiple issues with the same persona label spawn multiple sub-agents.

### After all sub-agents return

1. Check results for escalations (Blocked, Reassigned)
2. Log aggregate heartbeat to `.scottclip/heartbeat-log.jsonl`
3. Release lockfile
```

- [ ] **Step 3: Update Rules section**

Add to the existing Rules list:

```markdown
- **Dispatch, don't do.** After triage, spawn persona-worker sub-agents. Never do persona work yourself.
- **Parallel by default.** Spawn all sub-agents in one message when multiple issues are ready.
- **Read persona configs before spawning.** Extract model and thinking_effort from each persona's config.yaml.
```

- [ ] **Step 4: Commit**

```bash
git add agents/orchestrator.md
git commit -m "feat: add Agent tool and dispatch logic to orchestrator agent"
```

---

### Task 6: Update label-conventions reference — concurrent writer note

**Files:**
- Modify: `references/label-conventions.md`

- [ ] **Step 1: Update the Read-Modify-Write Pattern section**

Replace this:
```markdown
This is safe because ScottClip runs as a single instance per repo — no concurrent writers.
```

With this:
```markdown
With parallel sub-agent dispatch, multiple sub-agents may run concurrently. However, each sub-agent works a different issue, so label writes do not conflict — each agent only modifies labels on its own assigned issue.
```

- [ ] **Step 2: Commit**

```bash
git add references/label-conventions.md
git commit -m "docs: update label conventions for concurrent sub-agent execution"
```

---

### Task 7: Validate all changes

- [ ] **Step 1: Validate YAML in all modified/created files**

Run:
```bash
for f in agents/persona-worker.md agents/orchestrator.md; do
  echo "=== $f ==="
  python3 -c "import yaml; yaml.safe_load(open('$f').read().split('---')[1]); print('OK')"
done
```
Expected: `OK` for each file.

- [ ] **Step 2: Validate SKILL.md frontmatter**

Run:
```bash
python3 -c "import yaml; data = yaml.safe_load(open('skills/heartbeat/SKILL.md').read().split('---')[1]); print('name:', data['name']); print('description:', data['description'][:50]); assert data['name'] == 'heartbeat'"
```
Expected: name and description printed, no assertion error.

- [ ] **Step 3: Check all file references resolve**

Run:
```bash
for ref in references/comment-format.md references/label-conventions.md references/status-mapping.md; do
  test -f "$ref" && echo "$ref: OK" || echo "$ref: MISSING"
done
test -f agents/persona-worker.md && echo "agents/persona-worker.md: OK" || echo "agents/persona-worker.md: MISSING"
```
Expected: all files OK.

- [ ] **Step 4: Final commit if any fixes were needed**

```bash
git add -A && git diff --cached --stat
# Only commit if there are changes
git diff --cached --quiet || git commit -m "fix: validation fixes for parallel dispatch"
```
