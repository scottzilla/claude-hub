# Consolidated MCP Server Design

**Date:** 2026-04-06
**Status:** Validated

---

## Problem

ScottClip currently runs two separate processes:
- An MCP server (stdio transport, 26 Linear tools)
- A webhook receiver (HTTP, port 3847)

They share the same package, auth, and GraphQL client but run independently. The watch command must manage two processes, adding operational complexity.

---

## Decision

Consolidate into a single HTTP server. One process, one port (3847), three responsibilities: MCP tool serving, webhook handling, and OAuth.

**Stack:** Hono + `WebStandardStreamableHTTPServerTransport` from MCP SDK v1.29.0.

---

## Requirements

### Transport

- Use HTTP-only transport (no stdio). The server is always a long-running daemon.
- Claude Code connects via `StreamableHTTPClientTransport`.
- No dual-transport support.

### Framework

- Use Hono (~14KB) for routing and middleware.
- Use `WebStandardStreamableHTTPServerTransport` from the MCP SDK for portability (Node.js 18+).

### Routing

Single port 3847, path-based:

| Path | Methods | Handler |
|------|---------|---------|
| `/mcp` | POST, GET, DELETE | MCP StreamableHTTP transport (26 Linear tools) |
| `/webhook` | POST | Linear webhook handler (HMAC validation → store event → ack → spawn) |
| `/oauth/callback` | GET | OAuth token exchange |

### Session Spawning

- When a webhook arrives or polling finds an unprocessed issue, spawn a `claude` CLI process.
- Each issue gets a fresh session to avoid token accumulation.
- Spawning logic is shared between webhook handler and polling timer.

### Polling

- Include an internal polling timer (default interval: 15 minutes).
- Timer queries Linear for unprocessed issues and triggers session spawning.
- Configurable via `/scottclip-watch --interval <duration>`.
- `--interval 0` disables polling (webhook-only mode).

### Configuration

- **Global** `~/.claude/.mcp.json`: URL only (`http://localhost:3847/mcp`).
- **Local** `.scottclip/.env` in target repo: all credentials (see Environment Variables).
- Target repo directory = server's working directory (cwd).

---

## Architecture

```
Port 3847 (Hono)
├── POST/GET/DELETE /mcp     → WebStandardStreamableHTTPServerTransport
│                              (26 Linear tools, served to Claude Code)
├── POST /webhook            → Linear webhook handler
│                              (HMAC validation → store event → ack → spawn Claude)
├── GET  /oauth/callback     → OAuth token exchange
└── Internal: PollingTimer
    └── Every N minutes (configurable, default 15m):
        1. Query Linear for unprocessed issues
        2. For each new issue → spawnClaudeSession(issue)
```

---

## Module Structure

### Kept (unchanged)

| Module | Purpose |
|--------|---------|
| `src/auth.ts` | OAuth token management |
| `src/graphql.ts` | Linear GraphQL client |
| `src/events.ts` | File-based event storage/polling |
| `src/tools/` | All 26 MCP tool definitions |

### Rewritten

| Module | Changes |
|--------|---------|
| `src/server.ts` | Hono app, mounts all routes, starts polling timer |

### Extracted from `webhook/receiver.ts`

| Module | Extracted content |
|--------|------------------|
| `src/webhook.ts` | HMAC validation + event handling as Hono route handler |
| `src/oauth.ts` | OAuth callback as Hono route handler |
| `src/spawn.ts` | `spawnClaudeSession()` — shared by webhook handler and polling timer |

### New

| Module | Purpose |
|--------|---------|
| `src/polling.ts` | Timer that queries Linear for issues in Todo state without a recent heartbeat comment, deduplicates against in-flight spawned sessions, triggers spawning |

### Deleted

- `webhook/receiver.ts` (fully absorbed into server and extracted modules)
- `webhook/` directory

### New Dependencies

- `hono`

---

## npm Scripts

### Updated

| Script | Purpose |
|--------|---------|
| `start` | Run the consolidated server |
| `start:tunnel` | Start server + cloudflared tunnel |
| `stop` | Kill the server process |
| `dev` | Run with tsx for development |

### Removed

- `webhook`
- `webhook:stop`
- `webhook:restart`
- `webhook:tunnel`

---

## Environment Variables

Read from `.scottclip/.env` in server's cwd:

| Variable | Required | Purpose |
|----------|----------|---------|
| `LINEAR_CLIENT_ID` | Yes | OAuth client ID |
| `LINEAR_CLIENT_SECRET` | Yes | OAuth client secret |
| `LINEAR_WEBHOOK_SECRET` | No | HMAC signature validation (disabled if empty) |
| `LINEAR_CALLBACK_HOST` | Yes | Tunnel hostname for OAuth callback |
| `WEBHOOK_PORT` | No | Server port (default 3847) |

---

## Startup Sequence

1. User runs `/scottclip-watch` (or `npm run start` directly from repo dir).
2. Server reads `.scottclip/.env`, binds port 3847.
3. Registers 26 MCP tools via `WebStandardStreamableHTTPServerTransport`.
4. Starts polling timer (if interval > 0).
5. Claude Code connects to `http://localhost:3847/mcp` when tools are needed.
6. Linear webhooks arrive at `/webhook` via cloudflared tunnel.

---

## Impact on Skills and Commands

### `/scottclip-watch` (updated)

- Starts the consolidated server (replaces separate webhook receiver startup).
- `--interval <duration>` controls polling frequency (default 15m).
- `--interval 0` disables polling (webhook-only).
- `--stop` kills the server process.
- Removed flags: `--webhook-only`, `--poll-only`.

### `/scottclip-init` (updated)

- Phase 1:
  - Write global `~/.claude/.mcp.json` (URL only).
  - Write `.scottclip/.env` (credentials).
  - Run `npm install && npm run build`.
  - Start server for OAuth flow (not a separate receiver process).
- Phase 2: unchanged.

### `/heartbeat` (unchanged)

- Works as manual tool — connects to running server's MCP tools over HTTP.
- If server is not running, MCP tool calls fail and the skill reports an error.

### Event tools (kept)

- `linear_poll_events` and `linear_get_webhook_status` are retained for debugging and `/heartbeat` queue inspection.

---

## Migration Path

1. Build consolidated server (`src/server.ts`, extracted modules, `src/polling.ts`).
2. Update `/scottclip-init` to write global `.mcp.json` and `.scottclip/.env`.
3. Update `/scottclip-watch` to start/stop the single server process.
4. Delete `webhook/receiver.ts` and `webhook/` directory.
5. Remove obsolete npm scripts.
6. Update `CLAUDE.md` and `README` with new architecture.
