# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

ScottClip is a **Claude Code plugin** (no runtime code — entirely markdown/YAML). It provides Linear-backed agent orchestration with persona-based task routing. A single Claude instance wears different "hats" (personas) based on Linear issue labels.

**Design spec:** `docs/specs/2026-03-25-scottclip-design.md`
**Implementation plan:** `docs/specs/2026-03-25-scottclip-implementation-plan.md`
**Linear:** WotAI workspace, ScottClip project

## Architecture

### Two-level structure

1. **Plugin** (this repo) — ships commands, skills, agents, references, and persona templates. Installed via `claude plugin add`.
2. **Per-repo scaffold** (`.scottclip/`) — created by `/scottclip-init` in target repos. Contains `config.yaml`, persona directories, heartbeat log, and lockfile.

### Core loop

```
/heartbeat → Load Config → Check Inbox (Linear) → Pick Issue → Resolve Persona
  → Validate Tools → Lock Issue → Understand Context → Do Work → Report → Update State → Next/Exit
```

The heartbeat is a **skill** (`skills/heartbeat/SKILL.md`), not code. Claude follows it as a procedure using Linear MCP tools and repo tools.

### Persona system

Each persona = directory with 3 files:
- `SOUL.md` — identity injected into Claude's context (shapes behavior)
- `TOOLS.md` — available tools and usage patterns (shapes capabilities)
- `config.yaml` — machine-readable runtime config (model, thinking effort, max turns, required tools)

Routing: Linear issue label → `personas` map in config.yaml → persona directory.

### Persona hierarchy

- **Board** (human) – ultimate escalation target
- **CEO** persona – strategic decisions, prioritization, architecture (label: `ceo`)
- **Orchestrator** persona – mechanical triage/routing, default for unlabeled issues (label: none, `is_default: true`)
- **Worker personas** (Backend, Frontend, etc.) – implementation, escalate to CEO

### Key conventions

- **Labels = who, States = what.** Persona labels (`backend`, `frontend`, `ceo`) indicate which agent owns an issue. Linear workflow states (Todo → In Progress → Blocked → In Review → Done) track lifecycle. No status labels — states are the single source of truth. Labels are managed via read-modify-write (get labels array → modify → save full set).
- **Heartbeat counter is derived from comments**, not stored locally. Parse last `Heartbeat #N` from Linear comments.
- **Lockfile** (`.scottclip/.heartbeat-lock`) prevents concurrent heartbeats. Must be deleted on every exit path.
- **`${CLAUDE_PLUGIN_ROOT}`** — use this for all intra-plugin path references in commands and hooks. Never hardcode paths.
- **Templates use `{{USER_NAME}}` and `{{TEAM}}`** placeholders — the init skill replaces these when scaffolding.

## Plugin Component Map

| Type | Location | Auto-discovery |
|------|----------|---------------|
| Manifest | `.claude-plugin/plugin.json` | Required |
| Commands | `commands/*.md` | By filename |
| Skills | `skills/*/SKILL.md` | By SKILL.md presence |
| Agents | `agents/*.md` | By filename |
| Hooks | `hooks/hooks.json` | By convention |
| References | `references/*.md` | Referenced by skills |
| Templates | `templates/` | Used by init skill only |

## MCP Server (`mcp/linear-agent/`)

The plugin bundles a Hono-based HTTP server that Claude Code connects to via HTTP transport (not stdio). Key modules:

- `src/server.ts` — entry point; starts Hono on port 3847
- `src/spawn.ts` — spawns Claude agent sessions for incoming events
- `src/webhook.ts` — handles Linear webhook POST at `/webhook`
- `src/oauth.ts` — OAuth 2.0 callback handler at `/oauth/callback`
- `src/env.ts` — loads credentials from `.scottclip/.env`

The server previously had a separate `webhook/receiver.ts` — that file was deleted when the architecture was consolidated into the single Hono server.

**MCP transport:** HTTP (`WebStandardStreamableHTTPServerTransport`) at `/mcp`. The project-level `.mcp.json` uses a `url` key pointing to `http://localhost:3847/mcp` — not `command`/`args`. Credentials are stored in `.scottclip/.env`, not in the MCP config. **Important:** Claude Code only reads MCP configs from project `.mcp.json`, `~/.claude.json`, or `~/.claude/settings.json` — NOT from `~/.claude/.mcp.json`.

**npm scripts** (from `mcp/linear-agent/`): `start`, `stop`, `start:tunnel`, `test`, `test:watch`, `dev`, `build`.

## Working on This Repo

The plugin markdown/YAML is the primary artifact. The `mcp/linear-agent/` subdirectory has a full build system.

**Plugin files only** — editing markdown and YAML:
- No build step needed
- Test with: `claude --plugin-dir /path/to/scottclip`

**MCP server** (`mcp/linear-agent/`) — TypeScript with build and tests:
- Build: `npm run build`
- Test: `npm test` (vitest)
- Dev: `npm run dev` (watch mode)
- Dependencies: hono, @hono/node-server, vitest, @modelcontextprotocol/sdk

**Validation checklist:**
- YAML files parse cleanly (`python3 -c "import yaml; yaml.safe_load(open('file.yaml'))"`)
- SKILL.md files have valid frontmatter (`name` and `description` fields)
- Command .md files have valid frontmatter (`description` field)
- Agent .md files have valid frontmatter (`description` field)
- All file references in skills resolve (e.g., `${CLAUDE_PLUGIN_ROOT}/references/comment-format.md`)

## Editing Guidelines

- **Skills must use imperative/infinitive form** — "Read the config" not "You should read the config"
- **Skill descriptions must use third person** — "This skill should be used when..." not "Use this skill when..."
- **SKILL.md body target: 1,500-2,000 words.** Move detailed content to `references/` files.
- **Persona SOUL.md files are instructions TO Claude** — write them as identity directives, not documentation.
- **Config schema changes require bumping `version` field** in `templates/config.yaml` and updating the init skill's migration logic.
- **One persona label per issue.** The entire system assumes this — never design for dual-labeling.
