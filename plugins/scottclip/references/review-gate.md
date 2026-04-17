# Review Gate

The review gate sweep closes out parked work every heartbeat. Workers finish a task, commit to their worktree branch, and move the issue to "In Review" — then stop. The orchestrator's job is to detect these issues and drive them to Done (or escalate to a human).

## Candidate Detection

Query Linear for issues that are parked:

1. **"In Review" state** — any issue with state name "In Review", regardless of assignee.
2. **"In Progress" with stale agent comment** — issue is "In Progress", and the most recent comment (via `list_comments`) starts with `**🤖` (ScottClip agent comment), with no human comment following it.

Exclude issues already assigned to the board user (those are already human-owned).

## Classification Signals

For each candidate, read the most recent ScottClip comment (`**🤖 ...`). Apply exactly one classification in priority order:

### 1. Agent review requested

Any of the following in the comment body:
- "requesting review"
- "please review"
- `@review` (standalone token)
- `review-requested: agent`

→ Spawn a reviewer subagent.

### 2. Human review requested

Any of the following in the comment body:
- "needs human review"
- "blocked on human"
- `@human` (standalone token)
- `review-requested: human`
- Reference to a subjective, product, or design decision ("product decision", "design call", "stakeholder", "UX approval", "business logic unclear")

→ Reassign to human, post @-mention comment.

### 3. No signal

None of the above patterns match. The worker finished, committed, and moved to "In Review" without requesting anything specifically.

→ Spawn a merger subagent.

### When in doubt

If the comment is ambiguous and you cannot confidently apply one of the above, default to **human review**. It is better to route to a human than to accidentally merge unreviewed work.

## Classification Examples

### Example A — Agent review requested

```
**🤖 backend**

## Heartbeat #3 — 2026-04-15 14:22 UTC (18 min)

**Status:** In Review

### What was done
- [`a1b2c3d`] feat(api): add rate-limit handler
- Tests passing, coverage 87%

### What's next
Requesting review before merge — logic is non-trivial.

---
*ScottClip · backend · [WOT-42](link)*
```

Signal: "Requesting review" → **Agent review requested**.

### Example B — Human review requested

```
**🤖 frontend**

## Heartbeat #2 — 2026-04-15 09:10 UTC (12 min)

**Status:** In Review

### What was done
- Updated color palette and spacing tokens

### What's next
Needs human review — this is a design call and I'm not sure which palette aligns with the brand guidelines.

---
*ScottClip · frontend · [WOT-55](link)*
```

Signal: "needs human review" + "design call" → **Human review requested**.

### Example C — No signal

```
**🤖 backend**

## Heartbeat #4 — 2026-04-14 18:00 UTC (25 min)

**Status:** In Review

### What was done
- [`f9e1a2b`] fix(db): correct index on users.email
- [`c3d4e5f`] test(db): add regression test for duplicate email

### What's next
All checks passing.

---
*ScottClip · backend · [WOT-38](link)*
```

Signal: None → **No signal**, spawn merger subagent.

## Human Reassignment Comment Format

When routing to human, post this comment on the Linear issue:

```
**🤖 orchestrator**

@${user_name} — review needed for `<branch-name>`. <one-line summary of what the worker did>.

---
*ScottClip · orchestrator · [WOT-XX](link)*
```

- `${user_name}` — from `.scottclip/config.yaml` → `linear.user_name`
- `<branch-name>` — read from the issue's worktree or from the worker's commit list in the last comment
- Summary — one line, drawn from the worker's "What was done" section

Leave the issue in "In Review" state. Do not change the persona label.

## Reviewer Subagent Spawn Prompt

A reviewer is just a normal `persona-worker` subagent with a review-specific prompt. There is no separate reviewer persona and no persona inheritance logic — spawn it the same way as any other persona-worker, but instruct it to invoke the `superpowers:requesting-code-review` skill to perform the review.

Use this template when spawning a reviewer (Agent tool, `subagent_type: "persona-worker"`, `isolation: "worktree"`):

```
Thinking effort: medium

You are reviewing a branch another ScottClip worker committed. You are NOT implementing anything — you only review the diff and leave a verdict.

Issue: {issue_id} - {issue_title}
Branch: {branch_name}
Worktree path: {worktree_path}

Worker summary (latest heartbeat comment):
{last_worker_comment}

Review procedure:
1. cd to {worktree_path}
2. Determine the base and head SHAs:
   BASE_SHA=$(git merge-base main HEAD)
   HEAD_SHA=$(git rev-parse HEAD)
3. Invoke the `superpowers:requesting-code-review` skill via the Skill tool with:
   - WHAT_WAS_IMPLEMENTED: summary of the diff, drawn from the worker's heartbeat comment
   - PLAN_OR_REQUIREMENTS: the Linear issue description (title + body)
   - BASE_SHA: the merge-base computed above
   - HEAD_SHA: the current HEAD SHA
   - DESCRIPTION: one-line summary of the change
4. Read the skill's returned verdict (Strengths, Issues by severity, Assessment).
5. Run the project test command. If tests fail, treat as Changes Requested regardless of the review verdict.
6. Post a Linear comment on {issue_id} with your verdict, then act:

   Approved (no Critical or Important issues, tests pass):
   - Summarize what the review skill checked and its assessment
   - Run: git checkout main && git merge {branch} [--no-ff if repo convention requires]
   - Run: git push origin main
   - Run: git worktree remove {worktree_path}
   - Mark issue {issue_id} Done via Linear MCP
   - Post completion comment listing merged commits

   Changes requested (Critical/Important issues, or tests fail):
   - List the specific findings from the review skill, with severity labels
   - Post a Linear comment with `Reassigned → {original_worker_persona}` so the Orchestrator re-routes it (pull `{original_worker_persona}` from the issue's existing persona label; do NOT re-label to a reviewer persona)
   - Move issue back to In Progress via Linear MCP
   - Do NOT merge

Hard constraints — if any apply, do NOT proceed with merge:
- Never force-push under any circumstance
- Never merge when tests fail
- Never merge when CI is red
- Never merge when there are unresolved conflicts
- Never attempt to resolve conflicts yourself — escalate instead
- If any step fails unexpectedly, reassign issue to {user_name} and @-mention with failure description
```

## Merger Subagent Spawn Prompt

Use this template when spawning a merger subagent (Agent tool, `subagent_type: "persona-worker"`, `isolation: "worktree"`):

```
$AGENT_HOME = .scottclip/personas/{persona_name}
Thinking effort: low

You are a merge executor. You do NOT review code quality — only verify mechanical merge safety and execute the merge if safe.

Issue: {issue_id} - {issue_title}
Branch: {branch_name}
Worktree path: {worktree_path}
User for escalation: {user_name}

Worker summary (latest heartbeat comment):
{last_worker_comment}

Merge procedure:
1. cd to {worktree_path}
2. Verify branch is clean: git status --porcelain (output must be empty — no uncommitted changes)
3. Run the project test command. If tests fail, STOP — escalate to human.
4. Verify no conflicts: git fetch origin main && git merge --no-commit --no-ff origin/main; git merge --abort
5. Infer merge style: git log --oneline --graph -10 on main (look for merge commits — if present, use --no-ff; otherwise fast-forward)
6. Merge: git checkout main && git pull --ff-only && git merge {branch} [--no-ff if convention requires]
7. Push: git push origin main
8. Delete worktree: git worktree remove {worktree_path} --force
9. Post completion comment on {issue_id} listing merged commits
10. Mark issue {issue_id} Done via Linear MCP

HARD CONSTRAINTS — if any apply, STOP and escalate to human instead of proceeding:
- Never force-push under any circumstance
- Never merge when CI is red or tests fail
- Never merge when git reports unresolved conflicts
- Never merge when the branch is not clean (git status --porcelain is non-empty)
- Never merge if the branch is behind main by more than 0 commits that touch the same files (conflicts risk)
- If any step is ambiguous or fails unexpectedly:
  1. Run: git merge --abort (if a merge is in progress)
  2. Post a Linear comment on {issue_id} describing the failure
  3. Reassign issue to {user_name} via Linear MCP
  4. Post @-mention comment: "@{user_name} — merge failed for `{branch_name}`. <failure description>."
  5. Leave issue in In Review state
```

## Sweep Log Entry Format

After all candidates are processed, append to the heartbeat summary:

```
Review gate sweep: {N} candidates
  WOT-XX — [agent-review | human-review | merged | escalated] — {one-line outcome}
  WOT-YY — merged — fast-forward, 3 commits
  WOT-ZZ — human-review — reassigned to {user_name}: design decision
```
