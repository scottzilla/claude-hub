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

The heartbeat fetches all issues in the configured project (from `config.yaml` → `linear.project`), excluding terminal states (Done, Canceled, Duplicate), then filters client-side:

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
