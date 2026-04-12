# Auto-React Webhook Handler + Orchestrator Attachments Design

**Date:** 2026-04-11
**Status:** Draft

---

## Problem

The ScottClip webhook handler only processes `AgentSessionEvent` webhooks. All other Linear webhook events (Issue create, Issue update, label changes, state changes) are logged and silently ignored. This means:

- New issues created by humans sit idle until the next heartbeat poll (up to 15 minutes in watch mode)
- Label changes (manual reassignment) aren't picked up until the next heartbeat
- Issues unblocked by humans (state → Todo) wait for polling

---

## Decision

Add an Issue event handler to `webhook.ts` that triggers a heartbeat when actionable changes occur. Gated behind a `monitor.auto_react` config setting (default `false`). Includes a 30-second debounce to batch rapid-fire events.

---

## Requirements

### Configuration

New fields in `.scottclip/config.yaml`:

```yaml
monitor:
  auto_react: false      # true = webhook triggers heartbeat on Issue events
  quiet_window_s: 30     # debounce: seconds of no events before triggering heartbeat
```

Both optional. Defaults: `auto_react: false`, `quiet_window_s: 30`.

### Event Filter

Only react to specific Issue events. All others are logged and ignored.

| Event | Condition | Action |
|---|---|---|
| Issue created (`action: "create"`) | `actor.type !== "app"` (human created) | Queue heartbeat |
| Issue label changed (`action: "update"`) | `updatedFrom` has `labelIds` AND new label is a persona label | Queue heartbeat |
| Issue state → Todo (`action: "update"`) | `updatedFrom` has `stateId` AND new state is Todo | Queue heartbeat |
| Any Issue event | `actor.type === "app"` | Skip (bot-triggered, avoid loops) |
| Any other event type | — | Log and ignore (existing behavior) |

### Bot Guard

Issue events triggered by bots/agents must be skipped to prevent feedback loops (agent changes label → heartbeat → agent runs → changes label → ...).

Detection: `event.actor?.type === "app"`.

This is distinct from the AgentSessionEvent bot guard which checks `session.creator.isBot`.

### Debounce

Multiple Issue events can fire in rapid succession (e.g., orchestrator creating sub-issues with labels). Without debounce, each event would trigger a separate heartbeat.

Implementation:
1. First actionable event → start timer (`quiet_window_s`, default 30s)
2. Each subsequent actionable event → reset timer
3. Timer expires → spawn a heartbeat via `spawnClaudeSession` with a synthetic event
4. If a heartbeat/session is already running → skip, reset timer

The debounce is implemented in TypeScript in `webhook.ts` using `setTimeout` / `clearTimeout`. Simple module-level state:

```typescript
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let heartbeatRunning = false;
```

### Synthetic Heartbeat Event

When the debounce timer fires, the handler spawns a Claude session with a synthetic event that instructs it to run a heartbeat:

```typescript
const syntheticEvent = {
  type: "AutoReactHeartbeat",
  action: "created",
  agentSession: null,
  data: {
    id: `auto-react-${Date.now()}`,
    issueIdentifier: "heartbeat",
  },
  guidance: "Auto-react triggered by Issue webhook events. Run a heartbeat cycle: pick up issues from the inbox, triage unlabeled ones, dispatch to personas.",
  promptContext: `Triggered by ${pendingEvents.length} Issue event(s) in the last ${quietWindowS}s.`,
};
```

This reuses `spawnClaudeSession` but with a prompt that directs the agent to run a heartbeat rather than work a specific issue.

### Team Filter

Issue events must be filtered by team, same as AgentSessionEvent. Use `event.data?.teamId` and compare against `config.yaml → linear.team_id`. Skip events for other teams.

### Config Loading

`webhook.ts` currently reads `team_id` from config via `getConfiguredTeamId()`. Extend this to also read `monitor.auto_react` and `monitor.quiet_window_s`. Use the same YAML parsing approach (regex match on the config file).

---

## Changes Required

### 1. `webhook.ts` — Add Issue event handler

After the existing `AgentSessionEvent` handler (line ~109), add:

```
if (event.type === "Issue" && autoReactEnabled) {
  // Bot guard
  // Team filter
  // Event classification (create / label change / state change)
  // Debounce logic
}
```

### 2. `webhook.ts` — Add config reading

Extend `getConfiguredTeamId()` or add a new function to read `monitor.auto_react` and `monitor.quiet_window_s` from config.

### 3. `webhook.ts` — Add debounce state

Module-level variables for timer and running state.

### 4. `templates/config.yaml` — Add monitor defaults

Add commented `monitor` section.

### 5. `spawn.ts` — No changes needed

`spawnClaudeSession` already accepts arbitrary event objects. The synthetic event structure is compatible.

### 6. Tests — Add webhook handler tests

Test cases:
- Issue create from human → queues heartbeat
- Issue create from bot → skipped
- Issue label change → queues heartbeat
- Issue state → Todo → queues heartbeat
- Issue description edit → ignored
- Debounce: 3 rapid events → 1 heartbeat after quiet window
- `auto_react: false` → all Issue events ignored
- Wrong team → skipped

---

## Edge Cases

| Case | Handling |
|---|---|
| `auto_react` not in config | Default `false` — all Issue events ignored |
| Heartbeat already running when debounce fires | Skip, don't queue another |
| Server restart clears debounce state | Fine — timer resets, no persistent state needed |
| Event with no `actor` field | Treat as human (conservative — better to react than miss) |
| Event with no `teamId` | Skip if team filter configured (can't verify team membership) |
| Label changed but not to a persona label | Still queue heartbeat — orchestrator will handle triage |
| Rapid Issue creates (e.g., bulk import) | Debounce batches into single heartbeat |

---

## Testing

---

## Bundled Fix: Orchestrator Attachment Passthrough

### Problem

The webhook path (`spawn.ts` → `buildClaudeArgs`) fetches issue attachments and includes them in the agent prompt as `## Attachments` with title/URL. The orchestrator path does not — when the orchestrator spawns persona-workers, it passes issue ID, title, description, and comments but omits attachments.

Workers have `mcp__linear-agent__linear_get_attachment` in their tools list and the `linear-workflow` skill tells them to check attachments, but they aren't explicitly told about attachments in their spawn prompt. This creates an information gap vs webhook-spawned sessions.

### Fix

Modify `agents/orchestrator.md` Dispatch section to include attachments in the persona-worker spawn prompt.

In the "For each ready issue" subsection, after fetching issue details via `mcp__linear-agent__linear_get_issue`, also call `mcp__linear-agent__linear_get_attachment` to retrieve attachments. Include them in the persona-worker spawn prompt:

```
- Include in prompt: $AGENT_HOME, thinking effort, issue ID, title, description,
  recent comments, attachments (title + URL for each), agentSessionId
```

### Changes

- Modify: `agents/orchestrator.md` — Dispatch section step 5, add attachments to spawn prompt
- No TypeScript changes

---

## Testing

### Unit tests (vitest)

1. Event classification: verify each event type/action combo is correctly classified
2. Bot guard: verify `actor.type === "app"` events are skipped
3. Team filter: verify wrong-team events are skipped
4. Debounce: verify timer reset on rapid events, single heartbeat after quiet window
5. Config: verify `auto_react: false` skips all Issue events

### Manual validation

1. Enable `auto_react`, create an issue in Linear → verify heartbeat fires after 30s
2. Change a label on an issue → verify heartbeat fires
3. Move issue from Blocked to Todo → verify heartbeat fires
4. Have bot/agent create an issue → verify no heartbeat
5. Rapid-fire 3 label changes → verify single heartbeat after 30s quiet
6. Orchestrator spawns persona-worker → verify attachments appear in spawn prompt
