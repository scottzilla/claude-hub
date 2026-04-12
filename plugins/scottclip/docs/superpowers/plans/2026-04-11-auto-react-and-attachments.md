# Auto-React Webhook Handler + Orchestrator Attachments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the webhook handler react to Issue events (create, label change, state→Todo) by triggering a heartbeat, and pass attachments through the orchestrator spawn prompt.

**Architecture:** Add an Issue event handler to `webhook.ts` with bot guard, team filter, debounce (30s quiet window), and synthetic heartbeat spawn. Separately, update orchestrator markdown to include attachments in persona-worker prompts.

**Tech Stack:** TypeScript (Hono webhook handler, vitest tests), Markdown (orchestrator agent)

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `mcp/linear-agent/src/webhook.ts` | Modify | Add Issue event handler, config reader, debounce |
| `mcp/linear-agent/src/__tests__/webhook.test.ts` | Modify | Add tests for Issue event handler |
| `templates/config.yaml` | Modify | Add `monitor` section defaults |
| `agents/orchestrator.md` | Modify | Add attachments to persona-worker spawn prompt |

---

### Task 1: Add config reader for auto_react settings

**Files:**
- Modify: `mcp/linear-agent/src/webhook.ts:8-17`

- [ ] **Step 1: Write failing test**

Add to `mcp/linear-agent/src/__tests__/webhook.test.ts`:

```typescript
import { verifySignature, getAutoReactConfig } from "../webhook.js";

describe("getAutoReactConfig", () => {
  it("returns defaults when config has no monitor section", () => {
    const config = getAutoReactConfig("version: 2\nlinear:\n  team: test\n");
    expect(config).toEqual({ autoReact: false, quietWindowS: 30 });
  });

  it("reads auto_react and quiet_window_s from config", () => {
    const config = getAutoReactConfig(
      "version: 2\nmonitor:\n  auto_react: true\n  quiet_window_s: 15\n"
    );
    expect(config).toEqual({ autoReact: true, quietWindowS: 15 });
  });

  it("returns defaults for partial config", () => {
    const config = getAutoReactConfig("version: 2\nmonitor:\n  auto_react: true\n");
    expect(config).toEqual({ autoReact: true, quietWindowS: 30 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mcp/linear-agent && npx vitest run src/__tests__/webhook.test.ts`
Expected: FAIL — `getAutoReactConfig` not exported

- [ ] **Step 3: Implement getAutoReactConfig**

In `webhook.ts`, add after `getConfiguredTeamId()`:

```typescript
export interface AutoReactConfig {
  autoReact: boolean;
  quietWindowS: number;
}

export function getAutoReactConfig(raw?: string): AutoReactConfig {
  const defaults: AutoReactConfig = { autoReact: false, quietWindowS: 30 };
  const content = raw ?? readConfigRaw();
  if (!content) return defaults;

  const autoReactMatch = content.match(/^\s*auto_react:\s*(true|false)/m);
  const quietWindowMatch = content.match(/^\s*quiet_window_s:\s*(\d+)/m);

  return {
    autoReact: autoReactMatch ? autoReactMatch[1] === "true" : defaults.autoReact,
    quietWindowS: quietWindowMatch ? parseInt(quietWindowMatch[1], 10) : defaults.quietWindowS,
  };
}

function readConfigRaw(): string | null {
  const agentCwd = process.env.AGENT_CWD || process.cwd();
  try {
    return readFileSync(join(agentCwd, ".scottclip", "config.yaml"), "utf-8");
  } catch {
    return null;
  }
}
```

Also refactor `getConfiguredTeamId` to use `readConfigRaw`:

```typescript
function getConfiguredTeamId(): string | null {
  const raw = readConfigRaw();
  if (!raw) return null;
  const match = raw.match(/^\s*team_id:\s*"?([^"\n]+)"?/m);
  return match ? match[1].trim() : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mcp/linear-agent && npx vitest run src/__tests__/webhook.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add mcp/linear-agent/src/webhook.ts mcp/linear-agent/src/__tests__/webhook.test.ts
git commit -m "feat(webhook): add auto_react config reader"
```

---

### Task 2: Add Issue event classifier

**Files:**
- Modify: `mcp/linear-agent/src/webhook.ts`
- Modify: `mcp/linear-agent/src/__tests__/webhook.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `webhook.test.ts`:

```typescript
import { verifySignature, getAutoReactConfig, classifyIssueEvent } from "../webhook.js";

describe("classifyIssueEvent", () => {
  it("returns 'create' for human-created issue", () => {
    const event = {
      type: "Issue",
      action: "create",
      actor: { type: "user", name: "Scott" },
      data: { id: "issue-1", teamId: "team-1" },
    };
    expect(classifyIssueEvent(event)).toBe("create");
  });

  it("returns 'skip' for bot-created issue", () => {
    const event = {
      type: "Issue",
      action: "create",
      actor: { type: "app", name: "ScottClip" },
      data: { id: "issue-1", teamId: "team-1" },
    };
    expect(classifyIssueEvent(event)).toBe("skip");
  });

  it("returns 'label_change' when updatedFrom has labelIds", () => {
    const event = {
      type: "Issue",
      action: "update",
      actor: { type: "user", name: "Scott" },
      data: { id: "issue-1", teamId: "team-1" },
      updatedFrom: { labelIds: ["old-label-id"] },
    };
    expect(classifyIssueEvent(event)).toBe("label_change");
  });

  it("returns 'state_to_todo' when updatedFrom has stateId and new state is Todo", () => {
    const event = {
      type: "Issue",
      action: "update",
      actor: { type: "user", name: "Scott" },
      data: { id: "issue-1", teamId: "team-1", state: { name: "Todo" } },
      updatedFrom: { stateId: "old-state-id" },
    };
    expect(classifyIssueEvent(event)).toBe("state_to_todo");
  });

  it("returns 'skip' for state change not to Todo", () => {
    const event = {
      type: "Issue",
      action: "update",
      actor: { type: "user", name: "Scott" },
      data: { id: "issue-1", teamId: "team-1", state: { name: "Done" } },
      updatedFrom: { stateId: "old-state-id" },
    };
    expect(classifyIssueEvent(event)).toBe("skip");
  });

  it("returns 'skip' for description-only update", () => {
    const event = {
      type: "Issue",
      action: "update",
      actor: { type: "user", name: "Scott" },
      data: { id: "issue-1", teamId: "team-1" },
      updatedFrom: { description: "old description" },
    };
    expect(classifyIssueEvent(event)).toBe("skip");
  });

  it("returns 'skip' when no actor (conservative: treat as skip)", () => {
    const event = {
      type: "Issue",
      action: "create",
      data: { id: "issue-1", teamId: "team-1" },
    };
    expect(classifyIssueEvent(event)).toBe("create");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mcp/linear-agent && npx vitest run src/__tests__/webhook.test.ts`
Expected: FAIL — `classifyIssueEvent` not exported

- [ ] **Step 3: Implement classifyIssueEvent**

Add to `webhook.ts`:

```typescript
export type IssueEventAction = "create" | "label_change" | "state_to_todo" | "skip";

export function classifyIssueEvent(event: Record<string, unknown>): IssueEventAction {
  const actor = event.actor as Record<string, unknown> | undefined;
  const action = event.action as string;
  const data = event.data as Record<string, unknown> | undefined;
  const updatedFrom = event.updatedFrom as Record<string, unknown> | undefined;

  // Bot guard — skip events from apps/agents
  if (actor?.type === "app") return "skip";

  // Issue created by human
  if (action === "create") return "create";

  // Issue updated — check what changed
  if (action === "update" && updatedFrom) {
    // Label changed
    if ("labelIds" in updatedFrom) return "label_change";

    // State changed to Todo
    if ("stateId" in updatedFrom) {
      const state = (data?.state as Record<string, unknown>)?.name;
      if (state === "Todo") return "state_to_todo";
    }
  }

  return "skip";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mcp/linear-agent && npx vitest run src/__tests__/webhook.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add mcp/linear-agent/src/webhook.ts mcp/linear-agent/src/__tests__/webhook.test.ts
git commit -m "feat(webhook): add Issue event classifier with bot guard"
```

---

### Task 3: Add debounce and Issue event handler to webhook route

**Files:**
- Modify: `mcp/linear-agent/src/webhook.ts:36-133` (inside `createWebhookRoute`)

- [ ] **Step 1: Write failing tests for debounce**

Add to `webhook.test.ts`:

```typescript
import { vi } from "vitest";

describe("Issue event debounce", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Integration-style tests would need to call the Hono route directly.
  // For now, test the debounce helper in isolation.
});
```

Note: Full integration tests for the debounced handler require mocking `spawnClaudeSession` and the Hono app. We'll add a `createDebouncedHeartbeat` function that can be tested in isolation.

```typescript
import { verifySignature, getAutoReactConfig, classifyIssueEvent, createDebouncedHeartbeat } from "../webhook.js";

describe("createDebouncedHeartbeat", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires callback after quiet window", () => {
    const callback = vi.fn();
    const debounce = createDebouncedHeartbeat(5, callback);

    debounce.queue("event-1");
    expect(callback).not.toHaveBeenCalled();

    vi.advanceTimersByTime(5000);
    expect(callback).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledWith(1);
  });

  it("resets timer on subsequent events", () => {
    const callback = vi.fn();
    const debounce = createDebouncedHeartbeat(5, callback);

    debounce.queue("event-1");
    vi.advanceTimersByTime(3000);
    debounce.queue("event-2");
    vi.advanceTimersByTime(3000);
    expect(callback).not.toHaveBeenCalled();

    vi.advanceTimersByTime(2000);
    expect(callback).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledWith(2);
  });

  it("skips if heartbeat already running", () => {
    const callback = vi.fn();
    const debounce = createDebouncedHeartbeat(5, callback);

    debounce.setRunning(true);
    debounce.queue("event-1");
    vi.advanceTimersByTime(5000);
    expect(callback).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mcp/linear-agent && npx vitest run src/__tests__/webhook.test.ts`
Expected: FAIL — `createDebouncedHeartbeat` not exported

- [ ] **Step 3: Implement createDebouncedHeartbeat**

Add to `webhook.ts`:

```typescript
export interface DebouncedHeartbeat {
  queue(eventId: string): void;
  setRunning(running: boolean): void;
}

export function createDebouncedHeartbeat(
  quietWindowS: number,
  onFire: (eventCount: number) => void,
): DebouncedHeartbeat {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let eventCount = 0;
  let running = false;

  return {
    queue(eventId: string) {
      if (running) {
        console.log(`Debounce: skipping (heartbeat running), event ${eventId}`);
        return;
      }
      eventCount++;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const count = eventCount;
        eventCount = 0;
        timer = null;
        onFire(count);
      }, quietWindowS * 1000);
      console.log(`Debounce: queued event ${eventId} (${eventCount} pending, ${quietWindowS}s window)`);
    },
    setRunning(r: boolean) {
      running = r;
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mcp/linear-agent && npx vitest run src/__tests__/webhook.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Wire up Issue handler in createWebhookRoute**

In `webhook.ts`, inside `createWebhookRoute()`, add the debounce instance and Issue handler. After the closing `}` of the `AgentSessionEvent` block (line ~123) and before `return response;` (line ~125):

```typescript
      // --- Issue event handler (auto_react) ---
      if (event.type === "Issue") {
        const config = getAutoReactConfig();
        if (config.autoReact) {
          // Team filter
          const configuredTeamId = getConfiguredTeamId();
          const issueTeamId = (event.data as Record<string, unknown>)?.teamId as string | undefined;
          if (configuredTeamId && issueTeamId && issueTeamId !== configuredTeamId) {
            console.log(`Auto-react: ignoring Issue event for team ${issueTeamId}`);
            return response;
          }

          const classification = classifyIssueEvent(event);
          if (classification !== "skip") {
            console.log(`Auto-react: ${classification} event, queuing heartbeat`);
            debouncer.queue(`${event.action}-${(event.data as Record<string, unknown>)?.id || "unknown"}`);
          }
        }
      }
```

Also add the debounce instance at the top of `createWebhookRoute`, before `app.post`:

```typescript
  // Auto-react debounce — fires heartbeat after quiet window
  const debouncer = createDebouncedHeartbeat(
    getAutoReactConfig().quietWindowS,
    (eventCount) => {
      console.log(`Auto-react: firing heartbeat (${eventCount} events in window)`);
      debouncer.setRunning(true);
      const syntheticEvent: Record<string, unknown> = {
        type: "AutoReactHeartbeat",
        action: "created",
        data: {
          id: `auto-react-${Date.now()}`,
          issueIdentifier: "heartbeat",
        },
        guidance: "Auto-react triggered by Issue webhook events. Run a heartbeat cycle: pick up issues from the inbox, triage unlabeled ones, dispatch to personas.",
        promptContext: `Triggered by ${eventCount} Issue event(s).`,
      };
      spawnClaudeSession(syntheticEvent)
        .catch((err) => console.error("Auto-react spawn error:", err))
        .finally(() => debouncer.setRunning(false));
    },
  );
```

- [ ] **Step 6: Verify build passes**

Run: `cd mcp/linear-agent && npm run build`
Expected: Compiles (ignoring pre-existing SDK import error)

- [ ] **Step 7: Run all tests**

Run: `cd mcp/linear-agent && npx vitest run src/__tests__/webhook.test.ts`
Expected: All tests PASS

- [ ] **Step 8: Commit**

```bash
git add mcp/linear-agent/src/webhook.ts mcp/linear-agent/src/__tests__/webhook.test.ts
git commit -m "feat(webhook): add Issue event handler with debounced heartbeat"
```

---

### Task 4: Add monitor section to config template

**Files:**
- Modify: `templates/config.yaml`

- [ ] **Step 1: Add monitor section**

After the `heartbeat` section (after the `cooldown` block, around line 36), add:

```yaml

# Monitor: auto-react to webhook events
# When enabled, Issue create/update webhooks trigger a heartbeat automatically
# monitor:
#   auto_react: false      # true = webhook triggers heartbeat on Issue events
#   quiet_window_s: 30     # debounce: seconds of no events before triggering heartbeat
```

- [ ] **Step 2: Verify YAML parses**

Run: `python3 -c "import yaml; yaml.safe_load(open('templates/config.yaml'))"`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add templates/config.yaml
git commit -m "chore(scottclip): add monitor config template with auto_react defaults"
```

---

### Task 5: Add attachments to orchestrator spawn prompt

**Files:**
- Modify: `agents/orchestrator.md:104-114`

- [ ] **Step 1: Read current orchestrator.md**

Read `agents/orchestrator.md` to confirm the Dispatch section. Find step 5 in "For each ready issue" which lists what to include in the persona-worker spawn prompt.

- [ ] **Step 2: Edit the spawn prompt instruction**

In the Dispatch section, step 5, replace the prompt contents line:

```markdown
   - Include in prompt: `$AGENT_HOME`, thinking effort, issue ID, title, description, recent comments, `agentSessionId` (from your spawn prompt, for Linear activity reporting)
```

With:

```markdown
   - Include in prompt: `$AGENT_HOME`, thinking effort, issue ID, title, description, recent comments, attachments (fetch via `mcp__linear-agent__linear_get_attachment`, include title + URL for each), `agentSessionId` (from your spawn prompt, for Linear activity reporting)
```

- [ ] **Step 3: Verify the edit**

Read `agents/orchestrator.md` and confirm step 5 now mentions attachments.

- [ ] **Step 4: Commit**

```bash
git add agents/orchestrator.md
git commit -m "feat(scottclip): pass attachments in orchestrator persona-worker spawn prompt"
```

---

### Task 6: Build, test, validate

- [ ] **Step 1: Build**

Run: `cd mcp/linear-agent && npm run build`
Expected: Compiles (pre-existing SDK import error only)

- [ ] **Step 2: Run all tests**

Run: `cd mcp/linear-agent && npm test`
Expected: webhook tests all pass, no regressions

- [ ] **Step 3: Verify orchestrator.md end-to-end**

Read `agents/orchestrator.md` in full. Confirm:
- Dispatch step 5 includes attachments
- Reassignment loop (from prior PR) is intact
- Rules section unchanged

- [ ] **Step 4: Verify git status clean**

Run: `git status`
Expected: clean working tree
