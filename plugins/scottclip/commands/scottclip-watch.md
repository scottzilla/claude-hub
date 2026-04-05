---
description: Start ScottClip watch mode (webhook receiver + polling heartbeat)
argument-hint: "[--interval 15m] [--webhook-only] [--poll-only] [--stop]"
---

Start or stop ScottClip watch mode using the scottclip-watch skill.

Arguments passed: $ARGUMENTS

Parse the arguments:
- `--interval <duration>` — Heartbeat polling interval (default: 15m). Supports s/m/h suffixes.
- `--webhook-only` — Only start the webhook receiver, no polling.
- `--poll-only` — Only start the polling loop, no webhook receiver.
- `--stop` — Stop all watch processes (webhook receiver + polling loop).

Execute the watch procedure from the skill.
