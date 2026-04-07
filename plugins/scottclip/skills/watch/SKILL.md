---
name: scottclip-watch
description: This skill should be used when the user asks to "start watching", "watch for issues", "start the agent loop", "enable auto-heartbeat", "run in background", or runs the /scottclip-watch command. Starts the consolidated ScottClip server which handles webhooks, polling, MCP tools, and OAuth in a single process.
version: 0.2.0
---

# ScottClip Watch

Start the consolidated ScottClip server: a single Hono HTTP process on port 3847 that handles webhook events, polling heartbeats (built-in timer), MCP tools (`/mcp`), and OAuth callbacks (`/oauth/callback`).

**Arguments:**
- `--interval <duration>` — Heartbeat polling interval (default: `15m`). Accepts `s`, `m`, `h` suffixes.
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
| `--interval <duration>` | Set polling interval. Default `15m`. Parse duration: number + suffix (`s`=seconds, `m`=minutes, `h`=hours). Convert to milliseconds for `POLL_INTERVAL`. |
| `--stop` | Run Step 3 (stop server) and exit. |

## Step 2: Start Consolidated Server

1. Check if the server is already running:
   - Run `lsof -i :3847` to see if the port is in use.
   - If already running, report: "Consolidated server already running on port 3847" and skip to Step 4.

2. Read `team` from `.scottclip/config.yaml` — use as `POLL_TEAM_ID`.

3. Convert `--interval` duration to milliseconds (e.g., `15m` → `900000`). Use as `POLL_INTERVAL`.

4. Build the server (clean + install + compile):
   ```
   Run via Bash: cd <PLUGIN_ROOT>/mcp/linear-agent && rm -rf dist && npm install && npm run build
   ```
   This ensures the latest code is compiled. Must succeed before starting.

5. Start the server as a background daemon from the **target repo directory** (so `.scottclip/.env` is found):
   ```
   Run via Bash: cd <AGENT_CWD> && nohup node <PLUGIN_ROOT>/mcp/linear-agent/dist/server.js > .scottclip/server.log 2>&1 & echo $!
   ```
   Save the printed PID. Set env vars before the command: `POLL_INTERVAL=<ms> POLL_TEAM_ID=<team_id>`.

   `<PLUGIN_ROOT>` is `${CLAUDE_PLUGIN_ROOT}`. `<AGENT_CWD>` is from `.scottclip/.env` or the current working directory. The server loads `.scottclip/.env` automatically for credentials.

6. Wait 2 seconds, then verify the server started:
   - Run `lsof -i :3847` — should show a listening process.
   - If not running, report the error and suggest checking `.scottclip/server.log` and `.scottclip/.env`.

7. Report: "Consolidated server started on port 3847"

8. If the user hasn't set up a tunnel yet, suggest:
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

Display the watch configuration:

```
ScottClip Watch Active
──────────────────────
Server:   ✓ Running on port 3847
  MCP:    http://localhost:3847/mcp
  Webhook: http://localhost:3847/webhook
  OAuth:  http://localhost:3847/oauth/callback
Tunnel:   ⚠ Run 'npm run start:tunnel' to expose (from mcp/linear-agent/)
Polling:  ✓ Every 15m (built into server)

Events flow:
  Real-time: Linear → webhook → ack session → spawn Claude
  Polling:   server timer → /heartbeat → poll events + Linear issues
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
- Polling is built into the server — no separate `/loop` command needed.
- The server reads credentials from `.scottclip/.env` in `AGENT_CWD` (set at init time).
- The heartbeat lockfile (`.scottclip/.heartbeat-lock`) prevents concurrent heartbeats even if both webhook-spawned and poll-spawned sessions attempt to run simultaneously.
- For persistent scheduling that survives machine restarts, suggest using a process manager (e.g., `launchd`, `systemd`, `pm2`) to keep the server running.
