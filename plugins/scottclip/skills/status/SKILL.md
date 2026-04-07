---
name: status
description: This skill should be used when the user asks to "check scottclip status", "show agent status", "what is scottclip doing", "show heartbeat status", "what's in the queue", or runs the /scottclip-status command. Shows current ScottClip state, issue queue, and blocked items.
version: 0.1.0
---

# ScottClip Status

Display the current state of ScottClip in this repository: schedule info, last heartbeat, issue activity, queue, and blocked items.

**Arguments:**
- `--history` — Show recent heartbeat history from the log file

## Status Procedure

### Step 1: Load Config

Read `.scottclip/config.yaml`. If missing, report that ScottClip is not initialized and suggest `/scottclip-init`.

### Step 2: Check Server Health

Check if the consolidated HTTP server is running:
```
Run via Bash: curl -s -o /dev/null -w "%{http_code}" http://localhost:3847/ 2>/dev/null || echo "offline"
```

- **200** → Report `Server: ✓ Running on port 3847`. Also fetch and display the status page:
  ```
  Run via Bash: curl -s http://localhost:3847/ | head -5
  ```
- **offline** → Report `Server: ✗ Not running (start with /scottclip-watch or: cd <plugin_root>/mcp/linear-agent && npm run start)`

### Step 3: Check Schedule

Report schedule status as "unknown" — schedule state is not programmatically queryable from within Claude Code. The user manages their own `/schedule` configuration.

### Step 4: Last Heartbeat

Read the last line of `.scottclip/heartbeat-log.jsonl` (if it exists). Report:
- Heartbeat number, timestamp, and how long ago it ran
- Which persona and issue were involved
- Outcome (completed, in progress, blocked)

If no log file exists, report "No heartbeat history found."

### Step 5: Current Issues

Call `mcp__linear-agent__linear_list_issues` to fetch issues, scoping to the configured team (from `config.yaml` → `linear.team`) and optionally project (`linear.project`). To filter by team, first call `mcp__linear-agent__linear_list_teams` to resolve the team name to its ID, then pass `teamId` to `list_issues`. If `linear.project` is also set, pass `projectId` as well. Exclude terminal states. Filter and categorize by Linear state:

**Since last heartbeat** (issues that changed since the last logged heartbeat timestamp):
- `✓` Done issues (completed)
- `→` In Progress issues (actively being worked)
- `⏸` In Review issues (awaiting human review)
- `✗` Blocked issues
- `+` Newly created sub-issues

**Queue** (next heartbeat would pick these up):
- Issues with persona labels, status Todo or In Progress, sorted by priority
- Show: issue ID, persona label, status, priority, title

**Blocked** (needs Board attention):
- Issues in "Blocked" state
- Show: issue ID, Board user mention, blocker summary from last agent comment

### Step 6: Format Output

```
ScottClip Status
────────────────
Server:       ✓ Running on port 3847   — or —   ✗ Not running
Last beat:    Heartbeat #N — X min ago

Since last heartbeat:
  ✓ WOT-XX  [persona]   Done         "Title"
  → WOT-XX  [persona]   In Progress  "Title"
  ⏸ WOT-XX  [persona]   In Review    "Title"
  ✗ WOT-XX  [persona]   Blocked      "Title"

Queue (next heartbeat):
  WOT-XX  [persona]  Status  Priority  "Title"

Blocked (needs Board):
  WOT-XX  @User — blocker summary
```

## Error Handling

| Error | Response |
|-------|----------|
| `.scottclip/config.yaml` missing | Report ScottClip not initialized, suggest `/scottclip-init`. |
| Linear MCP unavailable | Report error, show only local data (config + log). |
| `heartbeat-log.jsonl` malformed | Skip malformed lines with warning, show what's parseable. |
| `heartbeat-log.jsonl` missing | Show "No heartbeat history found" for log-dependent sections. |

## History Mode

When `--history` is passed, read `.scottclip/heartbeat-log.jsonl` and display the last 10 entries:

```
Heartbeat History (last 10)
───────────────────────────
#N  HH:MM  persona  WOT-XX  Status      (duration)
#N  HH:MM  persona  WOT-XX  Status      (duration)
```

If the log file doesn't exist or is empty, report "No heartbeat history found."
