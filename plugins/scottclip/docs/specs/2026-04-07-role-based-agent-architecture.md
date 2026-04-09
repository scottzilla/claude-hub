# Role-Based Agent Architecture

**Date:** 2026-04-07
**Status:** Draft
**Author:** Scott + Claude
**Supersedes:** Persona system from 2026-03-25 design spec

## 1. Summary

Replace ScottClip's rigid persona model (SOUL.md + TOOLS.md + config.yaml per persona directory) with a lightweight role-based architecture. Roles are single-file descriptions injected into a generic worker agent's prompt at spawn time. The orchestrator infers or matches roles from Linear labels, preloads relevant skills, and spawns workers with runtime configuration declared in agent frontmatter rather than persona config files. This eliminates the scaffolding tax of the three-file persona structure while making the system more flexible — the orchestrator can compose ad-hoc roles on the fly for tasks that don't fit predefined templates.

## 2. Motivation

**Scaffolding tax.** Creating a new persona requires three files (SOUL.md, TOOLS.md, config.yaml), a config.yaml entry, and a Linear label. Most of the content in TOOLS.md is duplicated across personas. config.yaml fields like `model` and `max_turns` belong in the agent definition, not in persona-level config that the orchestrator must parse at dispatch time.

**Instruction fragility.** SOUL.md contains behavioral instructions that Claude follows on a best-effort basis. Critical constraints like worktree isolation, tool restrictions, and model selection should be runtime-enforced via agent frontmatter, not embedded in prose that can be ignored.

**Inflexibility.** Every new task type requires a predefined persona. The orchestrator cannot adapt — it can only route to existing personas or escalate. Ad-hoc roles (e.g., "write a migration script with Neon-specific constraints") require creating a full persona directory when a paragraph of context would suffice.

**TOOLS.md redundancy.** Every persona's TOOLS.md repeats the same Linear MCP patterns and repo tool descriptions. Tool availability should be declared once in agent frontmatter.

**Memory fragmentation.** Each persona has its own memory directory under `$AGENT_HOME/memory/`, fragmenting knowledge by persona rather than by project. A backend persona cannot learn from what the frontend persona discovered.

## 3. Architecture

```
                    ┌─────────────────────┐
                    │   Linear Webhook     │
                    │   (spawn.ts)         │
                    └─────────┬───────────┘
                              │ builds orchestrator prompt
                              ▼
                    ┌─────────────────────┐
                    │   Orchestrator       │
                    │   (top-level agent)  │
                    │   claude -p ...      │
                    │   --agent orchestrator│
                    └───┬─────────┬───────┘
                        │ Agent   │ Agent tool
                        │ tool    │
                  ┌─────▼──┐  ┌──▼──────┐
                  │ Worker  │  │ Worker  │
                  │ (role:  │  │ (role:  │
                  │ backend)│  │ ad-hoc) │
                  │ worktree│  │ worktree│
                  └─────────┘  └─────────┘
```

**Two levels only.** The orchestrator is the top-level agent spawned by `claude -p`. It uses the Agent tool to spawn workers. Workers cannot spawn sub-agents. This is a hard constraint of the Agent tool — sub-agents do not have access to it.

**Single worker definition.** One `worker.md` agent handles all roles. The orchestrator injects role context, skill references, and issue details into the worker's spawn prompt.

## 4. Role System

### Predefined roles

Live in `roles/` (plugin ships defaults, `/scottclip-init` copies to `.scottclip/roles/`):

```
.scottclip/roles/
  backend.md
  frontend.md
  ceo.md
```

Each role file is a single markdown file containing identity, posture, boundaries, and domain heuristics — the parts of SOUL.md that were unique per persona. No frontmatter required.

**Example: `backend.md`**
```markdown
# Backend Engineer

You own server-side implementation: APIs, database, business logic, integrations.

## Posture
- Bias toward shipping. Get working code merged, then iterate.
- Test the critical path. Not everything needs tests, but what breaks users does.

## Boundaries
- Do not modify frontend components or client-side code.
- Do not make design decisions — escalate UI/UX questions.

## Completion
- Done: code compiles, tests pass, straightforward change.
- In Review: touches shared infrastructure or has non-obvious trade-offs.
```

### Ad-hoc roles

The orchestrator can compose a role description inline when no predefined role fits:

```
You are a database migration specialist. Write a reversible migration
that adds a `bookings` table with the schema described in the issue.
Use Neon MCP for validation. Follow existing migration conventions
in `db/migrations/`.
```

Ad-hoc roles are not persisted. If the orchestrator finds itself composing the same ad-hoc role repeatedly, that is a signal to create a predefined role file.

### Linear label mapping

Labels become optional hints, not required routing keys:

| Scenario | Behavior |
|----------|----------|
| Issue has label `backend` | Orchestrator loads `roles/backend.md` |
| Issue has label `cto` but no `cto.md` exists | Orchestrator infers role from issue context |
| Issue has no persona label | Orchestrator infers role from issue context |
| Orchestrator is uncertain | Escalate to Board (same as today) |

The `personas:` map in config.yaml is replaced by a simpler `roles:` section:

```yaml
roles:
  directory: "roles"          # relative to .scottclip/
  labels:                     # optional label → role file mapping
    backend: "backend.md"
    frontend: "frontend.md"
    ceo: "ceo.md"
```

## 5. Agent Definitions

Agents are scaffolded to `.claude/agents/` by `/scottclip-init` (project-level, not plugin-level) so they can use `hooks`, `mcpServers`, and `permissionMode`.

### Orchestrator (`.claude/agents/orchestrator.md`)

```yaml
---
description: ScottClip orchestrator. Triages Linear issues, infers roles, spawns workers.
model: sonnet
memory: project
tools:
  - mcp__linear-agent__linear_list_issues
  - mcp__linear-agent__linear_get_issue
  - mcp__linear-agent__linear_save_issue
  - mcp__linear-agent__linear_create_comment
  - mcp__linear-agent__linear_list_labels
  - mcp__linear-agent__linear_list_comments
  - mcp__linear-agent__linear_create_label
  - mcp__linear-agent__linear_get_attachment
  - mcp__linear-agent__linear_search_documents
  - mcp__linear-agent__linear_get_document
  - Read
  - Grep
  - Glob
  - Agent
permissionMode: bypassPermissions
mcpServers:
  - linear-agent
---
```

### Worker (`.claude/agents/worker.md`)

```yaml
---
description: ScottClip worker. Executes a task with an injected role and preloaded skills.
model: opus
memory: project
isolation: worktree
tools:
  - mcp__linear-agent__linear_get_issue
  - mcp__linear-agent__linear_save_issue
  - mcp__linear-agent__linear_create_comment
  - mcp__linear-agent__linear_list_comments
  - mcp__linear-agent__linear_create_activity
  - mcp__linear-agent__linear_search_documents
  - mcp__linear-agent__linear_get_document
  - Read
  - Write
  - Edit
  - Bash
  - Grep
  - Glob
permissionMode: bypassPermissions
mcpServers:
  - linear-agent
---
```

Key changes from current persona-worker:
- `model` is in frontmatter (runtime-enforced), not read from persona config.yaml
- `isolation: worktree` is in frontmatter, not an orchestrator instruction
- `memory: project` replaces per-persona `$AGENT_HOME/memory/`
- `permissionMode` and `mcpServers` are possible because these are project-level agents
- No `Agent` tool — workers cannot spawn sub-agents

## 6. Skill Integration

Skills replace domain knowledge that currently lives in SOUL.md and TOOLS.md.

### How it works

The orchestrator decides which skills a worker needs based on the role and issue context. It includes skill references in the worker's spawn prompt:

```
## Role
[contents of roles/backend.md]

## Skills (preloaded)
- Read and follow: ${CLAUDE_PLUGIN_ROOT}/skills/linear-workflow/SKILL.md
- Read and follow: ${CLAUDE_PLUGIN_ROOT}/references/comment-format.md
- Read and follow: ${CLAUDE_PLUGIN_ROOT}/references/label-conventions.md
```

### What moves from SOUL.md to skills

| Current location | New location | Content |
|-----------------|-------------|---------|
| SOUL.md completion judgment | `skills/linear-workflow/SKILL.md` | State transitions, done vs review criteria |
| TOOLS.md Linear patterns | `skills/linear-workflow/SKILL.md` | Comment posting, label management, relations |
| TOOLS.md memory patterns | Removed | Replaced by native `memory: project` |
| SOUL.md quality checklist | Role file | Stays role-specific (backend vs frontend differ) |
| TOOLS.md common patterns | `references/common-patterns.md` | Feature impl, bug fix, database work recipes |

### Skill preloading vs invocation

Skills listed in the spawn prompt are **preloaded** — the worker reads them at startup as part of its context. This is distinct from skills that are merely available for invocation. The orchestrator controls what gets preloaded.

## 7. Memory Model

```
.claude/agent-memory/
  orchestrator/          # triage patterns, routing decisions, org context
  worker/                # implementation knowledge, shared across all roles
```

- **Orchestrator memory:** Accumulates triage patterns ("issues mentioning Stripe go to backend"), routing corrections ("CEO redirected X to frontend last time"), and org context.
- **Worker memory:** Shared across all role invocations. A backend-role worker's discovery about the codebase is available to a frontend-role worker next time. This fixes the persona-fragmented memory problem.
- **No more `$AGENT_HOME/memory/`** or `para-memory-files` skill. Native Claude Code agent memory handles persistence.

## 8. Init Changes

`/scottclip-init` scaffolds:

```
.scottclip/
  config.yaml              # simplified (roles: instead of personas:)
  roles/
    backend.md
    frontend.md
    ceo.md
.claude/
  agents/
    orchestrator.md        # project-level agent
    worker.md              # project-level agent
```

Key differences from current init:
- Creates `.claude/agents/` (project-level agents) instead of plugin-level agents
- Creates `roles/` instead of `personas/` with three-file directories
- config.yaml has `roles:` section instead of `personas:` section
- No TOOLS.md or persona config.yaml to scaffold
- Templates live in `templates/agents/` and `templates/roles/` in the plugin

## 9. Webhook Integration

`spawn.ts` changes:

**Before:** Builds a flat prompt with persona resolution instructions. Claude figures out the persona at runtime.

**After:** Builds an orchestrator-targeted prompt. The spawned `claude` process uses `--agent orchestrator` to load the project-level agent definition.

```typescript
const child = spawn(CLAUDE_BIN, [
  "-p",
  "--agent", "orchestrator",
  "--output-format", "stream-json",
  "--verbose",
], {
  cwd: targetRepo,
  stdio: ["pipe", "pipe", "pipe"],
  detached: true,
});
```

The orchestrator agent definition handles `permissionMode`, `mcpServers`, `model`, and `memory`. The spawn prompt becomes pure context (session ID, issue details, comments) with no behavioral instructions — those live in the agent definition and the orchestrator's body markdown.

Worker activities continue to go directly to Linear via `linear_create_activity` with the session ID passed through from the orchestrator.

## 10. Migration Path

### Automatic fallback

During the transition period, if a label maps to a role file that does not exist but a `personas/{name}/SOUL.md` does exist, the orchestrator reads SOUL.md as the role description. This provides backward compatibility without code changes.

### `/scottclip-migrate` command

Converts existing persona directories to role files:

1. Read `personas/{name}/SOUL.md` — extract to `roles/{name}.md`
2. Read `personas/{name}/TOOLS.md` — discard (replaced by skills + agent frontmatter)
3. Read `personas/{name}/config.yaml` — discard (replaced by agent frontmatter)
4. Update `config.yaml` — rewrite `personas:` section as `roles:` section
5. Scaffold `.claude/agents/orchestrator.md` and `.claude/agents/worker.md`
6. Print summary of what moved, what was discarded, and what to verify

### Migration order

1. Ship role system with fallback (roles and personas coexist)
2. Run `/scottclip-migrate` in each repo
3. Remove persona fallback code in a later release

## 11. What Gets Removed

| Component | Replacement |
|-----------|------------|
| `SOUL.md` (per persona) | `roles/{name}.md` (single file) |
| `TOOLS.md` (per persona) | Agent frontmatter `tools:` + shared skills |
| Persona `config.yaml` | Agent frontmatter (`model`, `isolation`, etc.) |
| `personas/` directory structure | `roles/` directory (flat files) |
| `persona-create` skill | Create a `.md` file in `roles/` (trivial, no skill needed) |
| `persona-import` skill | `/scottclip-migrate` command (one-time) |
| `persona-list` skill | `ls .scottclip/roles/` (trivial) |
| `para-memory-files` skill | Native `memory: project` in agent frontmatter |
| `persona-worker.md` (plugin agent) | `worker.md` (project-level agent) |
| `orchestrator.md` (plugin agent) | `orchestrator.md` (project-level agent) |
| `templates/personas/` | `templates/roles/` + `templates/agents/` |

## 12. Open Questions

1. **Model override per role.** The worker agent definition sets a default model (e.g., opus). Should the orchestrator be able to override the model per spawn (e.g., use sonnet for a simple role)? Agent frontmatter does not currently support per-invocation overrides. Workaround: multiple worker agent definitions (`worker-opus.md`, `worker-sonnet.md`).

2. **Skill preloading mechanics.** Does the worker read skill files at startup (explicit `Read` calls in the prompt), or does Claude Code support a `skills:` frontmatter field that auto-injects content? If the latter exists, use it. If not, the orchestrator must include skill file paths in the spawn prompt and the worker must read them.

3. **Agent frontmatter completeness.** The spec assumes `memory`, `isolation`, `permissionMode`, `mcpServers`, and `hooks` are supported in agent frontmatter. Verify which of these are actually implemented in the current Claude Code version before implementation.

4. **CEO as a role vs. a separate agent.** The CEO role never writes code and has different tool needs (no Write/Edit/Bash). Should it be a separate agent definition (`ceo-worker.md` without repo-write tools) or a role injected into the standard worker? Separate agent is cleaner but adds a third agent definition.

5. **Config version bump.** The `roles:` config section is not backward-compatible with `personas:`. This requires `version: 2` in config.yaml and migration logic in init. Define the exact migration behavior for `version: 1` configs encountering the new plugin.

6. **Heartbeat command.** The current heartbeat skill drives the core loop. With webhook-spawned sessions as the primary entry point and the orchestrator as a top-level agent, does `/scottclip-heartbeat` still make sense? It could invoke `claude --agent orchestrator` directly.
