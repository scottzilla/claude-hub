---
name: watch
description: This skill should be used when the user asks to "start watching", "watch for issues", "start the agent loop", "enable auto-heartbeat", "run in background", or runs the /sc-watch command. Starts the ScottClip MCP server and a recurring heartbeat loop.
version: 0.1.0
---

# ScottClip Watch

Start the MCP server and a recurring heartbeat loop.

## Steps

### Step 1: Start the MCP Server

Invoke the `scottclip:start` skill using the Skill tool. If `--stop` was passed in the arguments, pass it through and stop after the skill completes.

### Step 2: Start Heartbeat Loop

After the server is running, start a recurring heartbeat loop using the built-in `/loop` command:

```
/loop 15m /sc-heartbeat
```

This runs a heartbeat every 15 minutes in the current session. The heartbeat picks up Linear issues, resolves personas, and does work.

## Notes

- The server runs as a background process visible in the status line
- The heartbeat loop runs in the current session using the loaded MCP tools
- Use `/sc-start --stop` to stop just the server
- For manual heartbeats without the loop, use `/sc-heartbeat`
