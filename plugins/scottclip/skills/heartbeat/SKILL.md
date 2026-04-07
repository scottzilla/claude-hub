---
name: scottclip-heartbeat
description: This skill should be used when the user asks to "run a heartbeat", "run the agent loop", "process Linear issues", "check for work", or runs the /heartbeat command. Executes the ScottClip heartbeat — picks up Linear issues, resolves personas, does work, and reports back.
version: 0.1.0
---

# ScottClip Heartbeat

Execute the ScottClip heartbeat cycle: pick up assigned Linear issues, resolve the right persona, do the work, and report back with structured comments.

**Arguments:**
- `--dry-run` — Show what would be picked up without doing work
- `--persona <name>` — Only pick issues matching a specific persona
- `--issue <ID>` — Work a single issue by ID or identifier (e.g., WOT-42). Skips inbox scan — goes directly to Step 4 (Resolve Persona) for that issue.

**Reference files** (consult as needed during execution):
- `${CLAUDE_PLUGIN_ROOT}/references/comment-format.md` — Comment templates and rules
- `${CLAUDE_PLUGIN_ROOT}/references/label-conventions.md` — Label lifecycle and read-modify-write pattern
- `${CLAUDE_PLUGIN_ROOT}/references/status-mapping.md` — Linear states, sort order, inbox filtering

## Step 1: Load Config & Lock

1. Read `.scottclip/config.yaml`. If missing, stop and instruct the user to run `/scottclip-init`.
2. Check for lockfile at `.scottclip/.heartbeat-lock`.
   - If lockfile exists and is **less than** `stale_lock_hours` old → stop with message: "Previous heartbeat still active. Skipping."
   - If lockfile exists and is **older than** `stale_lock_hours` → delete it, log: "Cleaned stale lockfile."
   - If no lockfile → proceed.
3. Create lockfile with current ISO timestamp.
4. **On any exit path** (success, error, or early return), delete the lockfile.

Check quiet hours: if `quiet_hours.enabled` and current time is within the quiet window:
- `behavior: "skip"` → delete lockfile and exit with message: "Quiet hours active. Skipping."
- `behavior: "triage-only"` → proceed but only load Orchestrator persona (skip worker personas in Step 4 and Step 8).

## Step 2: Check Inbox

If `--issue <ID>` is set, skip Steps 2 and 3 entirely. Instead:
1. Call `mcp__claude_ai_Linear__get_issue` with the provided ID.
2. If the issue doesn't exist or is in a terminal state (Done, Canceled), exit: "Issue not found or already completed."
3. If the issue is in Backlog or Triage state (state type `backlog`), move it to "Todo" via `mcp__claude_ai_Linear__save_issue` before continuing — the explicit `--issue` flag means the agent was asked to work on it regardless of queue state.
4. Proceed directly to Step 4 with this single issue.

Otherwise, perform the normal inbox scan:

1. Call `mcp__claude_ai_Linear__list_issues` to fetch issues in the project. Filter to state types `unstarted` (Todo) and `started` (In Progress) only — this excludes Backlog, Triage, Done, Canceled, and Duplicate states at the API level.
   - If `list_issues` fails (network error, Linear API outage): delete lockfile and exit with error: "Linear API unavailable. Will retry next heartbeat."
2. Filter client-side:
   - **Keep** only issues with state type `unstarted` (Todo) or `started` (In Progress) — skip any Backlog/Triage issues that slipped through
   - **Skip** issues that have an assignee (claimed by another agent or human) — except issues the orchestrator itself claimed in a previous heartbeat (assignee is "me" and status is "In Progress")
   - **Skip** issues without a persona label (unless Orchestrator is default and issue has no label)
   - **Skip** "Blocked" issues unless new human comments exist since the last agent comment (check via `mcp__claude_ai_Linear__list_comments`)
3. Sort:
   - Primary: status — In Progress before Todo
   - Secondary: priority — Urgent > High > Medium > Low > None
4. Detect stale "In Progress" issues: if an issue is "In Progress" but has no heartbeat comment within `stale_lock_hours`, move it to "Todo" via `mcp__claude_ai_Linear__save_issue` and post a cleanup comment.

## Step 3: Collect Ready Issues

If `--issue <ID>` is set, this step was skipped — the single issue from Step 2 is the only issue to work.

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

## Step 4: Resolve Persona

1. Read the issue's labels. Match each label against the `personas` map in config to find persona labels.
2. **Multiple persona labels found** → halt work on this issue:
   - Post a comment: `⚠️ Multiple persona labels detected: \`backend\`, \`frontend\`. One issue = one persona. Remove extra labels and re-delegate.`
   - Reassign the issue to the board user (from `config.yaml` → `linear.user_name`) so it lands back in their inbox.
   - Release the delegate (set `delegateId: null`) if claimed.
   - Move the issue to Blocked state.
   - Proceed to the next issue.
3. **No persona label found** → load the persona with `is_default: true` (typically Orchestrator).
4. **Exactly one persona label** → load that persona.
3. Load persona files from `.scottclip/<persona.path>/`:
   - `SOUL.md` → inject into context as identity instructions
   - `TOOLS.md` → inject into context as tool guidance
   - `config.yaml` → read runtime settings

Apply runtime config from persona's `config.yaml`:
- `model` — note the target model (informational; cannot switch mid-session)
- `thinking_effort` — apply if supported
- `max_turns` — respect as work budget
- `enable_chrome` — note for browser-dependent tasks

## Step 5: Validate Tools

Read `required_tools` from persona config. For each entry, verify the tool prefix is available:
- `mcp__claude_ai_Linear` should match any tool starting with `mcp__claude_ai_Linear__`
- If a required tool prefix has **no matching tools** available → stop work on this issue immediately
  - Post a blocked comment naming the missing tool
  - Move issue to "Blocked" state via `mcp__claude_ai_Linear__save_issue`
  - Proceed to the next issue in the queue

## Step 6: Claim Issue

> **CRITICAL: You MUST set `assignee: "me"` on every issue before doing any work. This is the concurrency lock — without it, multiple agents can work the same issue simultaneously. Never skip this step.**

1. Call `mcp__claude_ai_Linear__get_issue` to read the issue's current state.
2. **Check assignee**: if the issue already has an assignee, **STOP — do not work this issue.** Another agent or human has claimed it. Proceed to the next issue.
   > Note: This check is a race-condition guard. Step 2 already filters assigned issues, but another agent may have claimed the issue between Step 2 and Step 6. Always re-check here.
3. **Claim**: call `mcp__claude_ai_Linear__save_issue` with `assignee: "me"` to lock the issue. This MUST happen before any other work on the issue.
4. If the issue is "Todo", also transition to "In Progress" in the same `save_issue` call.
5. If the issue is already "In Progress" (resuming interrupted work), just set assignee without state change.

## Step 7: Understand Context

1. Read issue title, description, and all comments via `mcp__claude_ai_Linear__get_issue` and `mcp__claude_ai_Linear__list_comments`.
2. If the issue has a parent, read the parent issue for broader context.
3. Identify new comments since the last heartbeat (look for comments after the last ScottClip-formatted comment).
4. Parse heartbeat counter: find the last comment matching `Heartbeat #N` pattern. Next comment will be `#N+1`. If none found, start at `#1`.

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

## Step 9: Collect Results

After all sub-agents return:

1. Parse each sub-agent's summary for: issue ID, final state, commits, sub-issues created, escalation flag.
2. **MUST release assignee**: for every completed or blocked issue, call `mcp__claude_ai_Linear__save_issue` with `assignee: null` to release the lock. Failing to release leaves the issue permanently locked. Keep assignee set only for issues still "In Progress" (will resume next heartbeat).
3. For any escalations (Blocked, Reassigned), log them for the heartbeat summary.
4. Append aggregate heartbeat metadata to `.scottclip/heartbeat-log.jsonl`:

    {"heartbeat": N, "timestamp": "ISO", "issues_dispatched": N, "results": [{"issue": "WOT-XX", "persona": "name", "status": "done|blocked|in_progress|reassigned", "commits": N, "sub_issues": N}], "duration_sec": N}

Note: Individual issue comments and state transitions are handled by sub-agents in Step 8. The orchestrator does not post per-issue comments.

## Step 10: Finalize

1. Verify all assignee releases from Step 9 succeeded.
2. If any `save_issue` calls failed during assignee release, retry once. If still failing, log the issue ID for manual cleanup.
3. If the orchestrator performed triage actions (labeling, decomposing) before dispatch, those state updates already happened during Step 8 triage — no additional updates needed here.

## Step 11: Next Cycle or Exit

1. If there are remaining issues in the inbox beyond `max_issues_per_heartbeat`, return to **Step 2** for the next batch.
2. Otherwise, delete lockfile and exit.
3. If 0 todo issues remain in queue, suggest pausing the schedule.
4. If 3+ issues are blocked across sub-agent results, suggest Board attention rather than more heartbeats.
