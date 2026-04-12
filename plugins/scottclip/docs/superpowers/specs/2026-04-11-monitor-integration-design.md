# Monitor Integration Design

**Date:** 2026-04-11
**Status:** Draft

---

## Problem

The ScottClip server logs webhook events, spawns, completions, and errors to `.scottclip/server.log`, but Claude has no visibility into these events during a session. Users must manually check logs to know what's happening. Non-AgentSession webhook events (Issue updates, label changes) are logged and ignored — there's no mechanism to react to them.

---

## Decision

Add a Claude Code Monitor tool call to both `/sc-start` and `/sc-watch` skills. The monitor tails the server log and surfaces events to Claude. A togglable `auto_react` setting controls whether Claude just reports events or also takes action (e.g., running a heartbeat when issues change).

---

## Requirements

### Monitor Tool Call

After the server is verified running, start a Monitor:

```json
{
  "description": "ScottClip server events",
  "command": "tail -f <AGENT_CWD>/.scottclip/server.log | grep --line-buffered -E 'Event received|Spawn|error|Session.*completed|Failed'",
  "timeout_ms": 3600000,
  "persistent": true
}
```

- `persistent: true` — runs for the entire session
- `timeout_ms: 3600000` — 1 hour max (re-established on next start/watch if session persists)
- `grep --line-buffered` — prevents pipe buffering delays
- Filter captures: webhook events, agent spawns, session completions, errors
- Filter excludes: MCP session init/close, ack logs, routine debug output

### Configuration

New fields in `.scottclip/config.yaml`:

```yaml
monitor:
  auto_react: false    # true = Claude acts on events, false = display only
  quiet_window_s: 30   # seconds of no events before triggering heartbeat (auto_react only)
```

Both fields optional. Defaults: `auto_react: false`, `quiet_window_s: 30`.

### Behavior Matrix

| `auto_react` | Event type | Claude does |
|---|---|---|
| `false` | Any event | Reports to user: "ScottClip: {event summary}" |
| `true` | Issue / IssueLabel update | Debounce → run `/sc-heartbeat` |
| `true` | AgentSessionEvent | Reports only (webhook already handles spawn) |
| `true` | Error / Failed | Reports + suggests action |
| `true` | Session completed | Reports completion summary |

### Debounce (auto_react only)

When `auto_react: true` and an actionable event arrives (Issue/IssueLabel update):

1. First actionable event → start quiet window timer (default 30s)
2. Each subsequent actionable event → reset timer to 30s
3. Timer expires (30s of quiet) → run `/sc-heartbeat`
4. If a heartbeat is already running → skip, reset timer

This prevents rapid-fire heartbeats during orchestrator triage bursts where multiple label changes happen in quick succession.

The debounce is instruction-level logic in the skill markdown — Claude tracks the quiet window mentally based on when monitor notifications arrive. No TypeScript code needed.

### Event Classification

Events from server.log match these patterns:

| Log pattern | Event type | Actionable (auto_react) |
|---|---|---|
| `Event received: AgentSessionEvent` | Agent session | No — webhook handles |
| `Event received: Issue` | Issue update | Yes — may need heartbeat |
| `Event received: IssueLabel` | Label change | Yes — may need heartbeat |
| `Event received: Project` | Project update | No — informational |
| `Spawning Claude for` | Agent spawn | No — informational |
| `Session .* completed` | Session done | No — informational |
| `error` / `Failed` | Error | Report + suggest fix |

---

## Changes Required

### 1. `skills/start/SKILL.md` — Add monitor step

After Step 2 (server start + verify), add Step 2.5:

1. Read `monitor` config from `.scottclip/config.yaml` (use defaults if absent)
2. Start Monitor tool with the log tail command
3. If `auto_react: true`, note in status output: "Auto-react enabled (30s quiet window)"
4. If `auto_react: false`, note: "Monitor active (display only)"

### 2. `skills/watch/SKILL.md` — Inherit monitor from start

The watch skill already invokes the start skill. No additional monitor call needed — it inherits from start. Update the notes section to document monitor behavior.

### 3. `templates/config.yaml` — Add monitor defaults

Add `monitor` section with commented defaults:

```yaml
# monitor:
#   auto_react: false    # true = Claude acts on events, false = display only
#   quiet_window_s: 30   # seconds of no events before triggering heartbeat
```

### 4. `skills/start/SKILL.md` — Add monitor event handling instructions

Add a new section after Step 4 (Report Status) describing how Claude should handle monitor notifications:

- **Display mode** (`auto_react: false`): Format and report each event
- **React mode** (`auto_react: true`): Classify event, debounce actionable events, trigger heartbeat after quiet window

### 5. No TypeScript changes

The Monitor reads the existing server.log. No changes to `webhook.ts`, `spawn.ts`, or `server.ts`.

---

## Edge Cases

| Case | Handling |
|---|---|
| Server not running when monitor starts | Monitor's `tail -f` waits for file creation — no error |
| Server log rotated/deleted | Monitor stops receiving events. Next `/sc-start` re-establishes |
| Multiple monitors started (repeated `/sc-start`) | Claude should check if monitor already active before starting another |
| `auto_react` changed mid-session | Takes effect on next `/sc-start` — monitor itself doesn't change, only reaction logic |
| Heartbeat takes longer than quiet window | Timer only starts after heartbeat completes or is skipped |
| No `.scottclip/config.yaml` monitor section | Use defaults: `auto_react: false`, `quiet_window_s: 30` |

---

## Testing

Manual validation:

1. **Display mode**: Start server, trigger webhook event, verify Claude reports it
2. **React mode**: Enable `auto_react`, trigger Issue update, verify 30s quiet → heartbeat runs
3. **Debounce**: Trigger 3 rapid Issue updates, verify only 1 heartbeat after 30s quiet
4. **AgentSession skip**: Trigger AgentSessionEvent with `auto_react: true`, verify no heartbeat (just report)
5. **Error surfacing**: Cause server error, verify Claude reports + suggests fix
