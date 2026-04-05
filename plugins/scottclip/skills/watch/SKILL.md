---
name: scottclip-watch
description: This skill should be used when the user asks to "start watching", "watch for issues", "start the agent loop", "enable auto-heartbeat", "run in background", or runs the /scottclip-watch command. Starts dual-mode watch — webhook receiver for real-time Linear events plus polling heartbeat as fallback.
version: 0.1.0
---

# ScottClip Watch

Start dual-mode watch: a webhook receiver for real-time Linear agent events, plus a polling heartbeat loop as a reliability fallback. Either mode can run independently.

**Arguments:**
- `--interval <duration>` — Heartbeat polling interval (default: `15m`). Accepts `s`, `m`, `h` suffixes.
- `--webhook-only` — Start only the webhook receiver (no polling).
- `--poll-only` — Start only the polling heartbeat loop (no webhook receiver).
- `--stop` — Stop all watch processes.

**Reference files:**
- `${CLAUDE_PLUGIN_ROOT}/references/status-mapping.md` — Linear state behavior

## Prerequisites

1. Read `.scottclip/config.yaml`. If missing, stop and instruct the user to run `/scottclip-init`.
2. Verify the `linear-agent` MCP server is available by checking that any tool starting with `mcp__linear_agent__` is callable. If not, instruct the user to configure the linear-agent MCP server.

## Step 1: Parse Arguments

Parse `$ARGUMENTS` for flags:

| Flag | Effect |
|------|--------|
| `--interval <duration>` | Set polling interval. Default `15m`. Parse duration: number + suffix (`s`=seconds, `m`=minutes, `h`=hours). |
| `--webhook-only` | Skip Step 3 (polling). Only start the webhook receiver. |
| `--poll-only` | Skip Step 2 (webhook). Only start the polling loop. |
| `--stop` | Run Step 5 (stop all) and exit. |

If no flags are provided, start both webhook receiver and polling (full dual-mode).

## Step 2: Start Webhook Receiver

> Skip this step if `--poll-only` is set.

1. Check if the webhook receiver is already running:
   - Run `lsof -i :3847` (or the configured `WEBHOOK_PORT`) to see if the port is in use.
   - If already running, report: "Webhook receiver already running on port 3847" and skip to Step 3.

2. Start the webhook receiver in the background:
   ```
   Run via Bash (background): cd <linear-agent-mcp-path> && npm run webhook
   ```
   The MCP path is the directory containing the `linear-agent` MCP server. Check the user's MCP configuration (`.mcp.json` or global MCP settings) to find it, or use the `LINEAR_AGENT_DIR` environment variable.

3. Wait 2 seconds, then verify the receiver started:
   - Run `lsof -i :3847` — should show a listening process.
   - If not running, report the error and suggest checking `LINEAR_WEBHOOK_SECRET` environment variable.

4. Report: "Webhook receiver started on port 3847"

5. If the user hasn't set up a tunnel yet, suggest:
   ```
   To expose the receiver to Linear, run in another terminal:
     cloudflared tunnel --url http://localhost:3847
   Then add the tunnel URL as a webhook in Linear: Settings → API → Webhooks
   ```

## Step 3: Start Polling Loop

> Skip this step if `--webhook-only` is set.

1. Parse the interval from `--interval` flag (default: `15m`).

2. Start the polling heartbeat loop using the `/loop` command:
   ```
   /loop <interval> /heartbeat
   ```
   This uses Claude Code's built-in `/loop` which runs the heartbeat at the specified interval while the session is active.

3. Report: "Polling heartbeat started (every `<interval>`)"

## Step 4: Report Status

Display the watch configuration:

```
ScottClip Watch Active
──────────────────────
Webhook:  ✓ Receiver on port 3847 (or ✗ Not started)
Tunnel:   ⚠ Run 'cloudflared tunnel --url http://localhost:3847' to expose
Polling:  ✓ Every 15m via /loop (or ✗ Not started)

Mode: dual (webhook + polling) | webhook-only | poll-only

Events flow:
  Real-time: Linear → webhook → ack session → spawn Claude
  Fallback:  /loop → /heartbeat → poll events + Linear issues
```

## Step 5: Stop Watch

> Run this step when `--stop` is passed.

1. Stop the polling loop:
   - Report: "Stopping polling loop — use `/loop stop` if it doesn't stop automatically."
   - Note: `/loop` tasks are session-scoped and stop when the session ends. The `--stop` flag is informational.

2. Stop the webhook receiver:
   - Find the receiver process: `lsof -i :3847 -t`
   - If found, kill it: `kill <pid>`
   - Report: "Webhook receiver stopped" or "No webhook receiver running"

3. Report: "ScottClip watch stopped."

## Error Handling

| Error | Response |
|-------|----------|
| `.scottclip/config.yaml` missing | Stop. Suggest `/scottclip-init`. |
| `linear-agent` MCP not available | Stop. Suggest configuring the MCP server. |
| Port 3847 already in use (not by receiver) | Report conflict. Suggest `WEBHOOK_PORT` env var. |
| Webhook receiver fails to start | Report error, continue with poll-only mode. |
| `/loop` not available | Report error, continue with webhook-only mode. |

## Notes

- The webhook receiver runs as a background process independent of the Claude Code session. It survives session restarts but not machine reboots.
- The polling loop via `/loop` is session-scoped — it stops when the Claude Code session ends.
- For persistent scheduling that survives session/machine restarts, suggest `/schedule` (cloud-based) instead of `/loop`.
- The webhook receiver and polling heartbeat are complementary: webhooks handle real-time delegation events, polling catches anything missed and processes the broader issue queue.
- The heartbeat lockfile (`.scottclip/.heartbeat-lock`) prevents concurrent heartbeats even if both webhook-spawned and poll-spawned sessions attempt to run simultaneously.
