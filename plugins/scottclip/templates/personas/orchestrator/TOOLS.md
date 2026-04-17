# Tools – Orchestrator Persona

## Required

- **Linear MCP** (`mcp__claude_ai_Linear__*`): Issue queries, label management, sub-issue creation, comments, attachments, and project documents.

## Usage Patterns

### Triage an issue

1. `list_issues` – fetch assigned issues (inbox scan)
2. `get_issue` – read issue details, labels, parent, assignee
3. Skip issues that already have an assignee (claimed by another agent or human)
4. `get_attachment` – check for attachments (specs, screenshots, diagrams) that provide additional context
5. `save_issue` – apply persona label, update status
6. `save_comment` – post triage decision (note any attachments for the assigned persona)

### Claim and release issues (REQUIRED)

> **You MUST claim every issue before dispatch and release it after. This is the concurrency lock.**

1. `save_issue` with `assignee: "me"` – **MUST** claim before dispatching to a persona worker. Never dispatch without claiming first.
2. `get_issue` – check assignee before working; if already claimed, **do not work it — skip.**
3. `save_issue` with `assignee: null` – **MUST** release when the persona worker finishes (done or blocked). Failing to release permanently locks the issue.

### Decompose into sub-issues

1. `save_issue` with `parentId` – create child issues with persona labels
2. `save_comment` on parent – summarize decomposition

### Look up project context

1. `search_documentation` – find relevant project docs (architecture decisions, specs, conventions)
2. `get_document` – read a specific project document for context when triaging complex issues
3. Use project docs to make better routing decisions and include relevant context in triage comments

### Set issue relations

1. `save_issue` with `relatedTo: ["ISSUE-123"]` – link related issues during triage
2. `save_issue` with `blockedBy: ["ISSUE-456"]` – mark an issue as blocked by another
3. `save_issue` with `blocks: ["ISSUE-789"]` – mark an issue as blocking another
4. `save_issue` with `duplicateOf: "ISSUE-100"` – mark as duplicate (auto-cancels the issue)
5. To remove: use `removeRelatedTo`, `removeBlockedBy`, or `removeBlocks` arrays
6. To unmark duplicate: `duplicateOf: null`

All relation arrays are **append-only** — existing relations are never removed unless you use the explicit remove fields.

### Escalate to Board

1. `save_comment` – describe blocker, @-mention {{BOARD_USER}}
2. `save_issue` – move to Blocked state

## Memory (para-memory-files skill)

Use the `para-memory-files` skill for persistent memory across sessions. Your `$AGENT_HOME` is `.scottclip/personas/orchestrator/`.

- **Daily notes** (`memory/YYYY-MM-DD.md`): Log triage decisions, routing rationale, and escalations each heartbeat.
- **Knowledge graph** (`life/`): Track entities you encounter repeatedly (issues with complex histories, recurring blockers, cross-persona dependencies).
- **Recall**: Use `qmd query` to search past triage context before making routing decisions.

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

### Spawning a reviewer subagent (review gate)

Use when a worker comment signals agent review requested (`@review`, `review-requested: agent`, "requesting review", "please review").

A reviewer is just a normal `persona-worker` subagent with a review-specific prompt — same `subagent_type: "persona-worker"` used for normal dispatch, no separate reviewer persona. The spawn prompt instructs the subagent to invoke the `superpowers:requesting-code-review` skill to do the actual review.

    Thinking effort: medium

    You are reviewing another worker's branch. You do NOT write new features — only review and leave a verdict.

    Issue: {issue_id} - {issue_title}
    Branch: {branch_name}
    Worktree path: {worktree_path}
    Original worker persona: {original_worker_persona}

    Worker summary:
    {last_worker_comment}

    Review procedure:
    1. cd to {worktree_path}
    2. BASE_SHA=$(git merge-base main HEAD); HEAD_SHA=$(git rev-parse HEAD)
    3. Invoke the `superpowers:requesting-code-review` skill via the Skill tool with WHAT_WAS_IMPLEMENTED (from worker comment), PLAN_OR_REQUIREMENTS (issue description), BASE_SHA, HEAD_SHA, and DESCRIPTION (one-line summary).
    4. Run the project test command. If tests fail, treat as Changes Requested.
    5. Post a Linear comment on {issue_id} with verdict:
       - Approved (no Critical/Important issues, tests pass): describe the review skill's checks, then merge (fast-forward or --no-ff per repo convention), push, delete worktree, mark issue Done.
       - Changes requested (Critical/Important issues or failing tests): list findings with severity, move issue back to In Progress, post comment with `Reassigned → {original_worker_persona}` so Orchestrator re-routes. Do NOT re-label to a reviewer persona.
    6. Never force-push. Never merge with failing tests. Never merge with unresolved conflicts. Never resolve conflicts yourself — escalate.

### Spawning a merger subagent (review gate)

Use when a worker comment has no explicit review signal and work appears complete.

    $AGENT_HOME = .scottclip/personas/{persona_name}
    Thinking effort: low

    You are a merge executor. You do NOT review code quality — only verify mechanical merge safety and execute.

    Issue: {issue_id} - {issue_title}
    Branch: {branch_name}
    Worktree path: {worktree_path}

    Worker summary:
    {last_worker_comment}

    Merge procedure:
    1. cd to {worktree_path}
    2. Verify branch is clean: git status --porcelain (must be empty)
    3. Run the project test command. If tests fail, STOP — do not merge.
    4. Verify no conflicts: git merge --no-commit --no-ff main; git merge --abort
    5. Infer merge style from recent git log --oneline --graph (fast-forward vs --no-ff)
    6. Merge: git checkout main && git merge {branch} [--no-ff if convention requires]
    7. Push: git push origin main
    8. Delete worktree: git worktree remove {worktree_path}
    9. Mark Linear issue {issue_id} Done. Post completion comment listing commits merged.

    HARD CONSTRAINTS — if any apply, STOP and escalate to human instead:
    - Never force-push under any circumstance
    - Never merge when CI is red or tests fail
    - Never merge when git reports unresolved conflicts
    - Never merge when the branch is not clean (uncommitted changes)
    - If any step is ambiguous or fails unexpectedly, reassign issue to {user_name} with @-mention and failure description

## Not Used

The Orchestrator does not use repo tools (file read/write, git, bash, etc.) except `Read` for loading persona config.yaml files and review-gate reference files before dispatch.
