---
name: scottclip-heartbeat-log
description: This skill should be used when the user asks to "show heartbeat log", "heartbeat history", "what has scottclip done", "show agent activity", "summarize heartbeats", or wants to analyze past heartbeat activity. Parses heartbeat-log.jsonl for summaries and analytics.
version: 0.1.0
---

# Heartbeat Log

Parse and summarize the ScottClip heartbeat log file (`.scottclip/heartbeat-log.jsonl`).

## Log Format

Each line is a JSON object — one record per heartbeat cycle (not per issue):
```json
{"heartbeat": 7, "timestamp": "2026-03-25T10:15:00Z", "issues_dispatched": 2, "results": [{"issue": "WOT-79", "persona": "backend", "status": "in_progress", "commits": 1, "sub_issues": 0}, {"issue": "WOT-81", "persona": "frontend", "status": "done", "commits": 2, "sub_issues": 0}], "duration_sec": 720}
```

Fields:
- `heartbeat` — Cycle counter (increments each heartbeat run)
- `timestamp` — ISO 8601 start time
- `issues_dispatched` — Number of issues worked this cycle
- `results[]` — Per-issue outcomes: issue ID, persona, final status, commit count, sub-issues created
- `duration_sec` — Wall-clock time for the entire cycle

## Procedure

### Step 1: Read Log

Read `.scottclip/heartbeat-log.jsonl`. If missing or empty, report "No heartbeat history found."

Parse each line as JSON. Handle malformed lines gracefully (skip with warning).

### Step 2: Summarize

**Recent activity** (default: last 10 heartbeats):

```
Heartbeat History
─────────────────
#7  10:15  backend   WOT-79  In Progress  (12 min)
#6  09:45  backend   WOT-81  Completed    (8 min)
#5  09:15  ceo       WOT-80  Triaged      (4 min)
```

**Aggregate stats** (when asked for analytics or summary):

- Total heartbeats
- Heartbeats per persona (breakdown)
- Average duration per persona
- Completion rate (completed / total)
- Most active issues (by heartbeat count)
- Blocked issues and duration blocked

### Step 3: Filter Options

Support filtering when the user asks:
- **By persona**: "show backend heartbeats" → filter by `results[].persona` field
- **By issue**: "show activity for WOT-79" → filter by `results[].issue` field
- **By date range**: "show today's heartbeats" → filter by `timestamp`
- **By status**: "show blocked heartbeats" → filter by `status`

## Notes

- The log file is append-only and informational — safe to truncate if it grows too large
- Heartbeat numbers are per-cycle counters (one number per heartbeat run), not per-issue
- Duration is wall-clock time from heartbeat start to report posting
