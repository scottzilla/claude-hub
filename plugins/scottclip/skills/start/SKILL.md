---
name: start
description: This skill should be used when the user asks to "start the server", "start ScottClip", or runs the /scottclip-start command. Starts the consolidated ScottClip MCP server which handles webhooks, MCP tools, and OAuth in a single process.
version: 0.3.0
---

# ScottClip Start

Start the consolidated ScottClip server: a single Hono HTTP process on port 3847 that handles webhook events, MCP tools (`/mcp`), and OAuth callbacks (`/oauth/callback`).

**Arguments:**
- `--stop` — Stop the server (kills process on port 3847).

**Reference files:**
- `${CLAUDE_PLUGIN_ROOT}/references/status-mapping.md` — Linear state behavior

## Prerequisites

1. Read `.scottclip/config.yaml`. If missing, stop and instruct the user to run `/scottclip-init`.
2. Verify the `linear-agent` MCP server is available by checking that any tool starting with `mcp__linear_agent__` is callable. If not, instruct the user to configure the linear-agent MCP server.

## Step 1: Parse Arguments

Parse `$ARGUMENTS` for flags:

| Flag | Effect |
|------|--------|
| `--stop` | Run Step 3 (stop server) and exit. |

## Step 2: Start Consolidated Server

1. Check if the server is already running:
   - Run `lsof -i :3847` to see if the port is in use.
   - If already running, report: "Consolidated server already running on port 3847" and skip to Step 4.

2. Build the server (clean + install + compile):
   ```
   Run via Bash: cd <PLUGIN_ROOT>/mcp/linear-agent && rm -rf dist && npm install && npm run build
   ```
   This ensures the latest code is compiled. Must succeed before starting.

3. Start the server as a background process (visible in Claude Code status line):
   ```
   Run via Bash (background): cd <AGENT_CWD> && AGENT_CWD=<AGENT_CWD> node <PLUGIN_ROOT>/mcp/linear-agent/dist/server.js 2>&1 | tee .scottclip/server.log
   ```
   Use `run_in_background: true` on the Bash tool call so it appears as an active task in the status line.

   `<PLUGIN_ROOT>` is `${CLAUDE_PLUGIN_ROOT}`. `<AGENT_CWD>` is from `.scottclip/.env` or the current working directory. The server loads `.scottclip/.env` automatically for credentials.

4. Wait 2 seconds, then verify the server started:
   - Run `lsof -i :3847` — should show a listening process.
   - If not running, report the error and suggest checking `.scottclip/server.log` and `.scottclip/.env`.

5. Report: "Consolidated server started on port 3847"

6. If the user hasn't set up a tunnel yet, suggest:
   ```
   To expose the server to Linear, run in another terminal:
     cd <PLUGIN_ROOT>/mcp/linear-agent && npm run start:tunnel
   Then add the tunnel URL as a webhook in Linear: Settings → API → Webhooks
   ```

## Step 3: Stop Server

> Run this step when `--stop` is passed.

1. Find the server process: `lsof -i :3847 -t`
2. If found, kill it: `kill <pid>` (or run `npm run stop` from `<PLUGIN_ROOT>/mcp/linear-agent`)
3. Report: "ScottClip server stopped" or "No server running on port 3847"

## Step 4: Report Status

Display the server configuration:

```
ScottClip Server Active
───────────────────────
Server:   ✓ Running on port 3847
  MCP:    http://localhost:3847/mcp
  Webhook: http://localhost:3847/webhook
  OAuth:  http://localhost:3847/oauth/callback
Tunnel:   ⚠ Run 'npm run start:tunnel' to expose (from mcp/linear-agent/)

Events flow:
  Real-time: Linear → webhook → ack session → spawn Claude
  On-demand: Run /heartbeat manually, or use /scottclip-watch for an automatic heartbeat loop
```

## Error Handling

| Error | Response |
|-------|----------|
| `.scottclip/config.yaml` missing | Stop. Suggest `/scottclip-init`. |
| `linear-agent` MCP not available | Stop. Suggest configuring the MCP server. |
| Port 3847 already in use (not by server) | Report conflict. Suggest stopping the occupying process. |
| Server fails to start | Report error, check `.scottclip/.env` for credentials. |

## Notes

- The server runs as a background process independent of the Claude Code session. It survives session restarts but not machine reboots.
- For periodic issue checking, run `/heartbeat` manually or use `/scottclip-watch` to start the server with an automatic heartbeat loop.
- The server reads credentials from `.scottclip/.env` in `AGENT_CWD` (set at init time).
- The heartbeat lockfile (`.scottclip/.heartbeat-lock`) prevents concurrent heartbeats even if multiple webhook-spawned sessions attempt to run simultaneously.
- For persistent scheduling that survives machine restarts, suggest using a process manager (e.g., `launchd`, `systemd`, `pm2`) to keep the server running.
