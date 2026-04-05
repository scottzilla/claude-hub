# State-Driven with Label Assignment

## Summary

Refactor ScottClip's Linear integration so that **Linear workflow states** drive issue lifecycle (Todo → In Progress → Blocked → In Review → Done) and **labels** are used exclusively for persona assignment (which agent owns the issue). This replaces the current dual-use of labels for both agent status (`agent-working`, `agent-blocked`) and persona routing.

**Core principle: Labels = who. States = what.**

## Motivation

Currently ScottClip uses labels for both persona routing AND agent status tracking (`agent-working`, `agent-blocked`). With a Blocked state added to the Linear workflow, these status labels are redundant with the workflow states. Separating concerns makes the system simpler: one source of truth for status (Linear state), one source of truth for ownership (persona labels). Linear views "just work" — filter by state, group by label.

## Linear Workflow States

Backlog → Todo → In Progress → Blocked → In Review → Done / Canceled

## State Machine

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

## Labels — Simplified

### Keep (persona assignment only)

- Labels under the `ScottClip` parent group: `backend`, `frontend`, `ceo`, plus any custom personas
- Meaning: "this persona owns this issue"
- One persona label per issue (never dual-label)

### Remove

- `agent-working` — replaced by "In Progress" state
- `agent-blocked` — replaced by "Blocked" state

## Inbox Query

Issues eligible for pickup by a heartbeat:

- **Eligible states:** Todo, In Progress (for resuming interrupted work)
- **Must have:** a persona label matching the current persona (or be unlabeled for the default/orchestrator persona)
- **Skip:** Blocked, In Review, Done, Canceled, Backlog
- **Sort order:** In Progress first (resume interrupted work), then Todo, then by priority (Urgent > High > Medium > Low)

## Reassignment Flow

When an agent hands off to another persona:

1. Swap persona label (remove own label, add target persona's label)
2. Move state back to Todo
3. Post a structured comment explaining the handoff and what the next persona needs to do

## Completion Judgment

The agent decides which completion path to take based on context. Guidance added to each persona's SOUL.md:

- **Done** — work is complete, tests pass, no ambiguity, low risk
- **In Review** — code changes that affect users, architectural decisions, anything with risk or that benefits from human verification
- **Reassign** — work is out of scope for this persona, needs different expertise, or requires another persona's approval

## Files That Change

### Skills (core behavior)

- `skills/heartbeat/SKILL.md` — Update inbox query to filter by state instead of labels. Step 6 (lock issue): transition state to In Progress via `save_issue`. Step 10 (update state): use state transitions (Done / In Review / Blocked / Todo+reassign) instead of label mutations. Remove all references to `agent-working` and `agent-blocked` labels.
- `skills/init/SKILL.md` — Remove creation of `agent-working` and `agent-blocked` labels during initialization. Only create persona labels.
- `skills/status/SKILL.md` — Query issues by Linear state (In Progress, Blocked, In Review) instead of filtering by `agent-working`/`agent-blocked` labels.

### References (documentation)

- `references/status-mapping.md` — Rewrite with full state machine table. Document all state transitions and who triggers them.
- `references/label-conventions.md` — Simplify to persona-assignment-only labels. Remove all state label documentation.
- `references/comment-format.md` — Add reassignment comment template. Minor updates.

### Templates (per-repo scaffold)

- `templates/config.yaml` — Remove `working_label` and `blocked_label` config keys from the labels section.
- `templates/personas/*/SOUL.md` — Add completion judgment guidance (Done vs In Review vs Reassign) to each persona's SOUL.md.

### Agents

- `agents/orchestrator.md` — Update description to reflect state-driven model.

### Plugin documentation

- `CLAUDE.md` — Update architecture description: labels=who, states=what. Remove references to state labels.

## What Stays the Same

- Persona label creation and routing logic
- Heartbeat comment format (counter, structured template)
- Lockfile system for preventing concurrent heartbeats
- Heartbeat log (`.scottclip/heartbeat-log.jsonl`)
- All slash commands (`/heartbeat`, `/scottclip-status`, `/scottclip-init`)
- Comment-based heartbeat counter derivation
- Persona directory structure (SOUL.md, TOOLS.md, config.yaml)

## Implementation Notes

- State transitions use `mcp__claude_ai_Linear__save_issue` with the appropriate state field
- The `save_issue` tool can update both state and labels in a single call when needed (e.g., reassignment = swap label + set state to Todo)
- Blocked reasons go in the heartbeat comment, not in labels
- Stale detection changes: instead of checking for `agent-working` label + no recent comment, check for "In Progress" state + no recent heartbeat comment
