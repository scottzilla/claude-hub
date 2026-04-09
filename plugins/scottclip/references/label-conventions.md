# Label Conventions

ScottClip uses Linear labels exclusively for role assignment — routing issues to the right agent role.

**Labels = who owns the issue. States = where it is in the lifecycle.**

## Label Group

All ScottClip labels live under a parent group (default: `ScottClip`). The group name is configurable in `config.yaml` → `labels.group`.

## Role Labels

Role labels route issues to the right role. Created by `/scottclip-init`.

| Label | Role | Typical signals |
|-------|------|-----------------|
| `backend` | Backend Engineer | API, endpoint, route, database, migration, query, webhook |
| `frontend` | Frontend Engineer | Component, UI, page, layout, styling, responsive, animation |
| `ceo` | CEO | Strategy, prioritization, roadmap, architecture, cross-cutting |
| *(none)* | Orchestrator (default) | Unlabeled issues — routed by the Orchestrator |

Additional role labels can be added by extending `config.yaml` `roles.labels` and will appear in config.

### Role Label Rules

- **One role label per issue.** Never dual-label — decompose into sub-issues instead.
- **Dual-label detection:** If an issue has multiple role labels, the heartbeat will block the issue and post a warning comment. Remove the extra label(s) before re-assigning.
- Labels are applied by the Orchestrator during triage, or manually by the Board.
- Custom role labels are added by extending `config.yaml` `roles.labels` and registered in config.

## Label Lifecycle

```
New issue (no labels)
  → Orchestrator triages → adds role label (e.g., "backend")
  → Heartbeat picks up → state moves to In Progress (no label change)
  → Work completes → state moves to Done/In Review (no label change)
  → Or blocked → state moves to Blocked (no label change)
  → Or reassigned → role label swapped, state moves to Todo
```

## Reassignment

When an agent hands off to another role:

1. Read current labels via `mcp__linear-agent__linear_get_issue`
2. Remove own role label, add target role label
3. Save the full label set and move state to Todo in a single `mcp__linear-agent__linear_save_issue` call
4. Post a handoff comment via `mcp__linear-agent__linear_create_comment` explaining what the next role needs to do

## Read-Modify-Write Pattern

Linear labels are managed as arrays. To change a role label:

1. `get_issue` — read current labels array
2. Modify the array (swap role labels)
3. `save_issue` — save the full label set

With parallel sub-agent dispatch, multiple sub-agents may run concurrently. However, each sub-agent works a different issue, so label writes do not conflict — each agent only modifies labels on its own assigned issue.
