---
description: Start ScottClip watch mode (consolidated server with webhook + polling)
argument-hint: "[--interval 15m] [--stop]"
---

Start or stop ScottClip watch mode using the scottclip-watch skill.

Arguments passed: $ARGUMENTS

Parse the arguments:
- `--interval <duration>` — Heartbeat polling interval (default: 15m). Supports s/m/h suffixes.
- `--stop` — Stop the consolidated server (kills process on port 3847).

Execute the watch procedure from the skill.
