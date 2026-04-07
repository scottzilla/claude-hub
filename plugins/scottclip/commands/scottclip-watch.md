---
description: Start ScottClip watch mode (MCP server + recurring heartbeat loop)
argument-hint: "[--stop]"
---

Start the MCP server and a recurring heartbeat loop.

1. First, use the Skill tool to invoke skill: "scottclip:start", args: "$ARGUMENTS"
   - If `--stop` was passed, stop here after the skill completes.

2. After the server is running, start a recurring heartbeat loop:
   Run the built-in /loop command: `/loop 15m /heartbeat`
   This runs /heartbeat every 15 minutes in the current session.
