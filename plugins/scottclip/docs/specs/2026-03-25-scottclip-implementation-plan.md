# ScottClip Implementation Plan

**Date:** 2026-03-25
**Spec:** `docs/specs/2026-03-25-scottclip-design.md`
**Linear:** [WOT-79](https://linear.app/wotai/issue/WOT-79/design-scottclip-agent-orchestration-system)

## Build Order

Implementation follows a dependency chain: plugin scaffold → config → personas → heartbeat → commands → polish.

### Phase 1: Plugin Scaffold

**Goal:** Empty but installable Claude Code plugin.

| Task | Files | Description |
|------|-------|-------------|
| 1.1 | `package.json` | Plugin manifest with name, version, description |
| 1.2 | `README.md` | Project overview, install instructions, quick start |
| 1.3 | Directory structure | Create `commands/`, `skills/`, `agents/`, `hooks/`, `references/`, `templates/` |

**Verify:** Plugin installs via `claude plugin add` from local path.

### Phase 2: Templates & Config

**Goal:** Per-repo config and persona templates ready for `/scottclip-init`.

| Task | Files | Description |
|------|-------|-------------|
| 2.1 | `templates/config.yaml` | Default config template with all fields, comments |
| 2.2 | `templates/personas/ceo/SOUL.md` | CEO persona template (triage, orchestration, no code) |
| 2.3 | `templates/personas/ceo/TOOLS.md` | CEO tools (Linear MCP only) |
| 2.4 | `templates/personas/ceo/config.yaml` | CEO runtime config (sonnet, medium thinking, 100 turns) |
| 2.5 | `templates/personas/backend/` | Backend engineer persona template (full set) |
| 2.6 | `templates/personas/frontend/` | Frontend engineer persona template (full set) |

**Verify:** Templates are valid YAML/markdown, all fields from spec present.

### Phase 3: Reference Docs

**Goal:** Shared reference docs the heartbeat and personas rely on.

| Task | Files | Description |
|------|-------|-------------|
| 3.1 | `references/comment-format.md` | Standard + blocked comment templates |
| 3.2 | `references/label-conventions.md` | Label names, group structure, heuristics table |
| 3.3 | `references/status-mapping.md` | Linear states ↔ ScottClip states mapping |

### Phase 4: Init Skill & Command

**Goal:** `/scottclip-init` scaffolds a repo with config + personas + Linear labels.

| Task | Files | Description |
|------|-------|-------------|
| 4.1 | `skills/init/SKILL.md` | Init skill: check Linear MCP, fetch user/team, scaffold config, create labels |
| 4.2 | `commands/scottclip-init.md` | Command wrapper for init skill |

**Verify:** Run `/scottclip-init` in pk-2026 repo, confirm config and personas created, labels exist in Linear.

### Phase 5: Heartbeat Skill & Command (Core)

**Goal:** `/heartbeat` executes the full 11-step procedure from spec.

| Task | Files | Description |
|------|-------|-------------|
| 5.1 | `skills/heartbeat/SKILL.md` | Core heartbeat procedure — all 11 steps |
| 5.2 | `commands/heartbeat.md` | Command wrapper with `--dry-run` and `--persona` flags |

This is the largest skill. Break the SKILL.md into clear sections matching spec steps:
1. Load config + lockfile check
2. Check inbox (Linear query + client-side filter/sort)
3. Pick issue (priority logic)
4. Resolve persona (label → directory mapping, load SOUL.md + TOOLS.md)
5. Validate tools (prefix matching)
6. Lock (read-modify-write labels)
7. Understand context (issue + parent + comments)
8. Do work (follow persona, create sub-issues or internal tasks)
9. Report (structured comment with heartbeat counter)
10. Update state (label management, status transitions)
11. Next issue or exit (lockfile cleanup)

**Verify:** Manual `/heartbeat` in pk-2026 with a test Linear issue. Confirm: picks issue, loads persona, posts comment, updates labels.

### Phase 6: Status & Utility Skills

**Goal:** `/scottclip-status`, `/persona-create`, `/persona-list`.

| Task | Files | Description |
|------|-------|-------------|
| 6.1 | `skills/status/SKILL.md` | Status skill: current state, since-last-beat diff, queue, blocked list |
| 6.2 | `commands/scottclip-status.md` | Command wrapper with `--history` flag |
| 6.3 | `skills/persona-create/SKILL.md` | Interactive persona creation (name, role, label, SOUL template) |
| 6.4 | `skills/persona-list/SKILL.md` | List configured personas with runtime config |
| 6.5 | `skills/heartbeat-log/SKILL.md` | Parse heartbeat-log.jsonl for summaries |

**Verify:** `/scottclip-status` shows accurate state after running heartbeat.

### Phase 7: CEO Agent & Triage

**Goal:** CEO subagent definition for automated triage.

| Task | Files | Description |
|------|-------|-------------|
| 7.1 | `agents/ceo.md` | CEO subagent: triage rules, decomposition, label heuristics, scope detection |

**Verify:** Unlabeled issue gets triaged by CEO persona — label applied or decomposed into sub-issues.

### Phase 8: Import & Polish

**Goal:** Paperclip migration path, hooks, final polish.

| Task | Files | Description |
|------|-------|-------------|
| 8.1 | `skills/persona-import/SKILL.md` | Convert Paperclip agent dirs to ScottClip personas |
| 8.2 | `hooks/hooks.json` | Optional hooks (if needed for auto-injection) |
| 8.3 | Polish | README updates, edge case handling, error messages |

**Verify:** Import a Paperclip agent (e.g., PK's CTO) and confirm persona structure is correct.

## Testing Strategy

| Phase | Test Method |
|-------|------------|
| 1 | Plugin installs without errors |
| 2-3 | Templates valid, YAML parses, markdown renders |
| 4 | `/scottclip-init` in scottclip → config + labels created |
| 5 | `/heartbeat --dry-run` → correct issue picked. Manual `/heartbeat` → comment posted |
| 6 | `/scottclip-status` → accurate output |
| 7 | Create unlabeled issue → CEO triages it |
| 8 | Import Paperclip CTO → valid persona files |

## Implementation Notes

- Build in the `scottclip` repo at `/Users/alexkim/Documents/Github-Mac-2026/scottclip/`
- Test against the WotAI Linear workspace (team: WotAI, project: ScottClip)
- Use scottclip as the first target repo for `/scottclip-init`
- Reference real Paperclip agents at `/Users/alexkim/Documents/Paperclip/agents/` and `/Users/alexkim/Documents/Paperclip-PK/agents/` for persona templates
- Use `plugin-dev` skills (`plugin-structure`, `skill-development`, `command-development`) during implementation; also wotai-testing
