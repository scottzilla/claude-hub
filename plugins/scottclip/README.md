# ScottClip

Linear-backed agent orchestration for Claude Code. A single Claude instance wears different "hats" (personas) based on Linear issue labels – an Orchestrator routes work, a CEO makes strategic calls, and worker personas execute.

## How It Works

```
Linear Issues → /heartbeat or /scottclip-watch → Persona Matching → Work → Report Back
```

1. **Issues** live in Linear with persona labels (`backend`, `frontend`, etc.)
2. **Heartbeat** picks the highest-priority issue and resolves which persona handles it
3. **Personas** (CEO, Backend, Frontend, ...) define identity, tools, and runtime config
4. **Reports** are structured comments on the Linear issue with progress, commits, and blockers
5. **Watch mode** runs automatically via `/scottclip-watch` (webhook receiver + polling) or Claude Code's `/schedule`

The human is the **Board** – the ultimate escalation target when the agent is blocked.

## Install

In Claude Code, run `/plugin` → **Add Marketplace** → enter `scottzilla/claude-hub`, then install the plugin.

Or for local development:

```bash
git clone https://github.com/scottzilla/scottclip.git
claude --plugin-dir /path/to/scottclip
```

### Prerequisites

- [Claude Code](https://claude.ai/code) installed
- Linear workspace with at least one team
- **Linear MCP** — either:
  - **Built-in Linear MCP** (simplest): Add to `.mcp.json`:
    ```json
    {
      "mcpServers": {
        "linear": {
          "type": "url",
          "url": "https://mcp.linear.app/sse"
        }
      }
    }
    ```
  - **Custom `linear-agent` MCP** (recommended for agent features): Enables delegate-based locking, agent sessions, and webhook events. See [claude-hub/mcps/linear-agent](https://github.com/scottzilla/claude-hub/tree/main/mcps/linear-agent) for setup.

## Quick Start

```bash
# 1. Initialize ScottClip in your repo (creates config + personas + Linear labels)
/scottclip-init

# 2. Run a single heartbeat cycle
/heartbeat

# 3. Start watch mode (webhook receiver + polling)
/scottclip-watch

# Or just schedule polling heartbeats
/schedule 30m /heartbeat

# 4. Check status
/scottclip-status
```

## The Heartbeat Loop

Each `/heartbeat` runs an 11-step cycle:

1. **Load config** – read `.scottclip/config.yaml`, check lockfile
2. **Check inbox** – query Linear for assigned issues, filter and sort
3. **Pick issue** – highest priority In Progress, then Todo
4. **Resolve persona** – match issue label → persona directory, load SOUL.md + TOOLS.md
5. **Validate tools** – check required MCP tools are available
6. **Claim issue** – set assignee (or delegate with custom MCP) to lock the issue
7. **Understand context** – read issue, comments, parent, heartbeat counter
8. **Do work** – follow persona instructions (CEO triages, workers implement)
9. **Report** – post structured comment with progress, commits, sub-issues
10. **Update state** – manage labels based on outcome (done/blocked/continuing)
11. **Next or exit** – pick another issue or clean up and stop

Use `--dry-run` to see what would be picked without doing work. Use `--persona backend` to force a specific persona.

## Personas

Each persona gets its own directory with three files:

| File | Purpose |
|------|---------|
| `SOUL.md` | Identity, posture, voice, decision framework |
| `TOOLS.md` | Available tools and integrations |
| `config.yaml` | Runtime config (model, thinking effort, max turns) |

### Default Personas

| Persona | Role | Model | Turns | Label |
|---------|------|-------|-------|-------|
| Orchestrator | Route issues, decompose work | Haiku | 50 | *(default – no label)* |
| CEO | Strategy, prioritization, architecture | Sonnet | 100 | `ceo` |
| Backend | API, database, server-side | Opus | 300 | `backend` |
| Frontend | UI, components, styling | Sonnet | 200 | `frontend` |

Create custom personas with `/persona-create` or copy directories between repos.

### Per-Repo Structure

After `/scottclip-init`, your repo gets:

```
.scottclip/
├── config.yaml              # Linear settings, heartbeat behavior, persona routing
├── heartbeat-log.jsonl      # Append-only heartbeat history (created at runtime)
└── personas/
    ├── orchestrator/
    │   ├── SOUL.md
    │   ├── TOOLS.md
    │   └── config.yaml
    ├── ceo/
    │   ├── SOUL.md
    │   ├── TOOLS.md
    │   └── config.yaml
    ├── backend/
    │   ├── SOUL.md
    │   ├── TOOLS.md
    │   └── config.yaml
    └── frontend/
        ├── SOUL.md
        ├── TOOLS.md
        └── config.yaml
```

## Commands

| Command | Description |
|---------|-------------|
| `/heartbeat` | Run one heartbeat cycle |
| `/heartbeat --dry-run` | Show what would be picked up |
| `/heartbeat --persona backend` | Force a specific persona |
| `/scottclip-init` | Initialize ScottClip in a repo |
| `/scottclip-status` | Current state, queue, blocked issues |
| `/scottclip-status --history` | Recent heartbeat history |
| `/scottclip-watch` | Start watch mode (webhook + polling) |
| `/scottclip-watch --interval 5m` | Custom polling interval |
| `/scottclip-watch --webhook-only` | Webhook receiver only |
| `/scottclip-watch --poll-only` | Polling heartbeat only |
| `/scottclip-watch --stop` | Stop all watch processes |
| `/persona-create` | Create a new persona interactively |
| `/persona-list` | List configured personas |

## Label System

ScottClip uses Linear labels solely for persona assignment. Workflow status is tracked via Linear's built-in states.

| Label | Purpose |
|-------|---------|
| `backend`, `frontend`, etc. | Routes issue to the matching persona |

**Workflow states** (Todo → In Progress → Blocked → In Review → Done) are the single source of truth for issue lifecycle. Labels are managed via read-modify-write (get labels array → modify → save full set).

All persona labels live under a "ScottClip" parent group in Linear, created by `/scottclip-init`.

## Memory

Personas use the `para-memory-files` skill for persistent memory across sessions, organized by Tiago Forte's PARA method:

- **Knowledge graph** (`$AGENT_HOME/life/`) — entity-based facts in PARA folders (projects, areas, resources, archives)
- **Daily notes** (`$AGENT_HOME/memory/YYYY-MM-DD.md`) — raw timeline of work per heartbeat
- **Tacit knowledge** (`$AGENT_HOME/MEMORY.md`) — learned patterns and operating preferences

Use `qmd query` to search past context before starting work.

## Watch Mode & Scheduling

ScottClip supports two modes for autonomous operation:

### Watch mode (recommended)

`/scottclip-watch` starts dual-mode operation: a webhook receiver for real-time Linear agent events, plus a polling heartbeat as a reliability fallback.

```bash
/scottclip-watch                  # Both modes, 15m polling default
/scottclip-watch --interval 5m   # Faster polling
/scottclip-watch --webhook-only   # Real-time only (requires tunnel setup)
/scottclip-watch --poll-only      # Polling only (no webhook receiver)
/scottclip-watch --stop           # Stop everything
```

The webhook receiver listens for Linear agent session events (delegation, user messages) and spawns Claude sessions in real-time. The polling heartbeat catches anything missed and processes the broader issue queue.

**Webhook setup:** The receiver runs on port 3847. Expose it via `cloudflared tunnel --url http://localhost:3847`, then register the tunnel URL as a webhook in Linear (Settings → API → Webhooks → `AgentSessionEvent`).

### Schedule-only mode

For simpler setups without webhooks:

| Workload | Cadence | Command |
|----------|---------|---------|
| Active sprint | Every 15-30 min | `/schedule 15m /heartbeat` |
| Steady state | Every 1-2 hours | `/schedule 1h /heartbeat` |
| Background | Every 4-6 hours | `/schedule 4h /heartbeat` |
| Manual only | No schedule | `/heartbeat` when needed |

## Migrating from Paperclip

Use `/persona-import` to convert Paperclip agent directories into ScottClip personas. It maps SOUL.md, TOOLS.md, HEARTBEAT.md role-specific sections, and AGENTS.md safety rules into the ScottClip format. Budget tracking and approval workflows are not imported (intentionally omitted from v1). PARA memory is carried over — ScottClip includes the `para-memory-files` skill.

## Background

ScottClip is inspired by [Paperclip](https://github.com/paperclipai/paperclip), an agent orchestration platform that uses a central API for task management, agent checkout, and chain-of-command routing. ScottClip takes the same core ideas – persona-based identity, structured heartbeats, hierarchical escalation – and rebuilds them as a Claude Code plugin backed by Linear instead of a custom API. The result is simpler (no database, optional lightweight webhook receiver) while keeping the parts that worked well: SOUL.md for agent identity, structured comments for audit trails, and a CEO/worker hierarchy for task decomposition.

## Design

See [`docs/specs/2026-03-25-scottclip-design.md`](docs/specs/2026-03-25-scottclip-design.md) for the full design spec and [`docs/specs/2026-03-25-scottclip-implementation-plan.md`](docs/specs/2026-03-25-scottclip-implementation-plan.md) for the build order.

## License

MIT
