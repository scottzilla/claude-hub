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
| `ceo` | CEO | Strategy, prioritization, roadmap, architecture, cross-cutting |
| *(none)* | Orchestrator (default) | Unlabeled issues — routed by the Orchestrator |

Additional persona labels can be added via `/persona-create` and will appear in `config.yaml`.

### Persona Label Rules

- **One persona label per issue.** Never dual-label — decompose into sub-issues instead.
- **Dual-label detection:** If an issue has multiple persona labels, the heartbeat will block the issue and post a warning comment. Remove the extra label(s) before re-assigning.
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

1. Read current labels via `mcp__claude_ai_Linear__get_issue`
2. Remove own persona label, add target persona label
3. Save the full label set and move state to Todo in a single `mcp__claude_ai_Linear__save_issue` call
4. Post a handoff comment via `mcp__claude_ai_Linear__save_comment` explaining what the next persona needs to do

## Read-Modify-Write Pattern

Linear labels are managed as arrays. To change a persona label:

1. `get_issue` — read current labels array
2. Modify the array (swap persona labels)
3. `save_issue` — save the full label set

With parallel sub-agent dispatch, multiple sub-agents may run concurrently. However, each sub-agent works a different issue, so label writes do not conflict — each agent only modifies labels on its own assigned issue.
