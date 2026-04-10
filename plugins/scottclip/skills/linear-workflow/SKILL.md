---
name: linear-workflow
description: This skill should be used by ScottClip workers when interacting with Linear issues. Covers state transitions, comment formatting, label management, issue relations, and completion judgment. Loaded automatically via worker agent skills frontmatter.
version: 0.1.0
---

# Linear Workflow

Apply consistent patterns for all Linear issue interactions: state transitions, comments, label changes, issue relations, and completion judgment.

All state transitions and field updates use `mcp__linear-agent__linear_save_issue`. All comments use `mcp__linear-agent__linear_save_comment`.

## State Transitions

Linear states are the single source of truth for issue lifecycle. Use these transitions:

| Trigger | From | To | Notes |
|---------|------|----|-------|
| Pick up an issue | Todo | In Progress | Set `assignee: "me"` in the same call |
| Work complete, agent confident | In Progress | Done | Release assignee (`assignee: null`) |
| Work complete, wants human check | In Progress | In Review | Release assignee (`assignee: null`) |
| Stuck, cannot proceed | In Progress | Blocked | Post blocked comment naming who must act; release assignee |
| Wrong persona for this work | In Progress | Todo | Swap persona label; post handoff comment; release assignee |
| Human unblocks | Blocked | Todo | Human action — agent does not trigger this |
| Human approves review | In Review | Done | Human action — agent does not trigger this |
| Human requests changes | In Review | Todo | Human action — agent does not trigger this |

**Claim before working.** Before doing any work on an issue, call `mcp__linear-agent__linear_save_issue` with both `assignee: "me"` and the "In Progress" state ID in a single call. Always re-read the issue immediately before claiming — if the assignee field is already set, another agent or human has claimed it. Skip the issue and proceed to the next one in the queue.

**Release on every exit path.** Every completed, blocked, or reassigned issue must have `assignee: null` set before the heartbeat ends. This is the concurrency unlock — failing to release permanently locks the issue from future heartbeats. Issues that remain genuinely In Progress (work continues next heartbeat) may keep the assignee set.

**State names are exact strings.** Use the state display name as configured in Linear (e.g., `"Todo"`, `"In Progress"`, `"Blocked"`, `"In Review"`, `"Done"`). State IDs can be retrieved via `mcp__linear-agent__linear_get_issue` if the display name lookup fails.

## Comment Format

Read and follow `${CLAUDE_PLUGIN_ROOT}/references/comment-format.md` for full templates (standard, blocked, reassignment, triage, decomposition).

Key rules:
- Open every comment with `**🤖 persona-name**` — all agents post as the same Linear user, so the persona must be explicit.
- Include heartbeat counter (`#N`) and timestamp on every standard comment.
- **Derive the counter from comments**, not local storage: call `mcp__linear-agent__linear_list_comments`, find the last `Heartbeat #N` pattern, increment. Start at `#1` if none found.
- Blocked comments must name the Board user by display name (from `config.yaml → linear.board_user`) and state a specific ask.
- Completion comments must list shipped commits or PRs with links.
- Footer format: `ScottClip · persona-name · [WOT-XX](link) · from [Heartbeat #N-1](link)`.

## Label Management

Read and follow `${CLAUDE_PLUGIN_ROOT}/references/label-conventions.md` for full conventions.

Key rules:
- **One persona label per issue.** If an issue has multiple persona labels, post a warning comment, move to Blocked, and release the assignee — do not work it.
- Labels route ownership; states track lifecycle. Never use labels as status indicators.

**Read-modify-write pattern** for all label changes:
1. `mcp__linear-agent__linear_get_issue` — read current labels array.
2. Modify the array (add, remove, or swap persona labels).
3. `mcp__linear-agent__linear_save_issue` — save the full modified label set.

**Reassignment label swap:**
1. Read current labels.
2. Remove own persona label; add target persona label.
3. Save labels + set state to Todo in a single `save_issue` call.
4. Post a reassignment comment explaining what was done and what the next persona must do.

## Issue Relations

Set relations via `mcp__linear-agent__linear_save_issue` when you discover dependencies during work. Set them as soon as the dependency is known — do not wait until the end of the heartbeat.

| Field | Meaning |
|-------|---------|
| `blockedBy: ["ISSUE-456"]` | This issue cannot proceed until ISSUE-456 is done |
| `blocks: ["ISSUE-789"]` | This issue must complete before ISSUE-789 can proceed |
| `relatedTo: ["ISSUE-123"]` | Informational link to a related issue |
| `duplicateOf: "ISSUE-100"` | Marks this issue as a duplicate; Linear auto-cancels it |

**Append-only arrays.** Passing a relation field adds to the existing list — it does not replace it. Never reconstruct or overwrite the full relation array; only append the new relation. To remove a relation, use the explicit remove fields: `removeBlockedBy`, `removeBlocks`, `removeRelatedTo`. To un-mark a duplicate, pass `duplicateOf: null`.

**When to set blockedBy vs. moving to Blocked state:** setting `blockedBy` creates a dependency link in Linear but does not change the workflow state. Move the issue to the Blocked workflow state only when you cannot continue work until the dependency is resolved. Both can be true simultaneously: set `blockedBy` to create the link, then transition to Blocked state and post a blocked comment.

## Common Work Patterns

### Feature implementation
1. Read the issue and all comments (`mcp__linear-agent__linear_get_issue`, `mcp__linear-agent__linear_list_comments`).
2. Check for attachments (`mcp__linear-agent__linear_get_attachment`) — specs, wireframes, data samples, API docs. Attachments often contain the authoritative spec; always check before starting implementation.
3. Search project documents (`mcp__linear-agent__linear_search_documentation`, `mcp__linear-agent__linear_get_document`) for relevant conventions or API contracts.
4. Read the parent issue if this is a sub-issue — broader context often clarifies scope.
5. Read existing code (Read, Grep, Glob).
6. Implement changes (Edit, Write).
7. Run tests (Bash).
8. Commit (Bash — git). Write a clear commit message referencing the issue identifier (e.g., `feat(api): add rate limiting [WOT-42]`).
9. Post heartbeat comment with full commit SHAs and links.

### Bug fix
1. Read the issue; check attachments for error logs, screenshots, or reproduction data.
2. Reproduce the bug locally before touching any code — confirm you understand what triggers it.
3. Find relevant code (Grep, Glob).
4. Fix the bug; add a regression test that would have caught the original failure.
5. Commit and post heartbeat comment.

### Reference project documents
1. `mcp__linear-agent__linear_search_documentation` — find architecture decisions, specs, or conventions by keyword.
2. `mcp__linear-agent__linear_get_document` — read the specific document by ID before starting work.
3. Always check project docs for coding conventions, API contracts, and integration notes before writing code — avoid rediscovering known patterns.

### Check parent for context
When working a sub-issue, read the parent issue via `mcp__linear-agent__linear_get_issue` for broader context before starting implementation. The parent description often contains the acceptance criteria, overall approach, or sequencing constraints that are not repeated on child issues.

### Resume interrupted work
When picking up an In Progress issue from a previous heartbeat:
1. Read all comments to find the last `Heartbeat #N` — this is your starting counter.
2. Identify what was completed (from previous comment's "What was done").
3. Identify what remains (from "What's next" in the previous comment).
4. Continue from where the previous heartbeat left off — do not redo completed steps.

## Completion Judgment

Apply this decision table at the end of every issue:

| Situation | Action |
|-----------|--------|
| Work is complete, verified, low risk | → **Done** |
| Touches shared systems, non-obvious trade-offs, or user-facing changes | → **In Review** |
| This work belongs to a different persona | → **Reassign** (swap label + Todo) |
| Cannot proceed without external input | → **Blocked** |
| Work spans more than one heartbeat's budget | → Stay **In Progress** (keep assignee, post progress comment) |

**When in doubt, prefer In Review over Done.** The cost of a missed review is higher than the cost of a brief human check.

**In Review signals:**
- Changes touch a shared API, database schema, or authentication flow.
- The implementation required a non-obvious trade-off that the Board should be aware of.
- Changes affect user-visible behavior, copy, or layout.
- Uncertainty exists about whether the implementation matches the intent of the issue.

**Done signals:**
- All acceptance criteria are met and verified.
- Tests pass locally.
- Commits are clean and referenced in the heartbeat comment.
- No shared systems were changed in ways that could affect other issues.

**Reassign signals:**
- The implementation work clearly belongs to a different persona (e.g., a backend issue that turned out to require only frontend changes).
- Post a reassignment comment before swapping the label — the next persona needs context on what was discovered and what they must do.

Always release `assignee: null` on Done, In Review, Blocked, and Reassigned transitions. Keep assignee set only when the issue remains In Progress for the next heartbeat.

## Verification Inference

Before marking an issue Done or In Review, check whether the issue has explicit acceptance criteria.

**If acceptance criteria exist:** verify each criterion and document the results in your heartbeat comment.

**If no acceptance criteria exist:** infer a reasonable verification step based on the issue title and description, perform it, and flag it in your comment:

> Note: No acceptance criteria were specified. Inferred verification: [describe what you checked and how]. Review and adjust if needed.

Flag inferred verifications with `⚠️` on the Status line:

```
**Status:** ⚠️ Completed (inferred verification — see note)
```

This signals to the reviewer that the acceptance criteria were ambiguous and the agent made a judgment call.
