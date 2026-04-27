# Multi-Repo Routing for ScottClip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-repo `process.env.AGENT_CWD` binding with a global teamId → repo registry so one scottclip server process serves N repos in a single Linear workspace via a single OAuth app and a single tunnel URL.

**Architecture:** A new global registry at `~/.scottclip/registry.json` maps `teamId → { cwd, configPath, organizationId }`. The webhook handler extracts `teamId` from the inbound event, looks up the registry, builds a `RepoContext`, and threads it through `spawnClaudeSession`, the auto-react debouncer, and the stop-signal handler. Per-repo `.scottclip/.env` and `token.json` are hoisted to global locations during `/sc-init` migration; OAuth state binds the callback to the correct registry entry.

**Tech Stack:** TypeScript + Node, Hono router, `@modelcontextprotocol/sdk`, Linear GraphQL, Vitest. No new runtime dependencies — lockfile uses `fs.openSync(path, "wx")` (O_EXCL) and HMAC uses the built-in `node:crypto`.

---

## Design Adjustments

Verified against `/Users/scottzilla/code/claude-hub/worktrees/scottclip-multi-repo/plugins/scottclip/mcp/linear-agent/src/` on 2026-04-26. The following adjustments to the prompt's design assumptions were made based on what the live code actually does:

1. **No `linear_get_organization` tool exists.** The current viewer query at `src/tools/teams.ts:21-25` returns only `{ id, name, email }`. To capture `organizationId` during `/sc-init` and the OAuth callback, Task 7 adds a `GetOrganization` GraphQL query inside `oauth.ts` (no new MCP tool — internal use only). The skill (Task 8) calls the existing `linear_get_viewer` tool first and then a new `linear_get_organization` tool which Task 7 also exposes for skill use.
2. **Stop-signal teamId source is unverified upstream (Q2).** Task 4 includes an explicit "instrumentation step" that adds a `console.log(JSON.stringify(event, null, 2))` for `signal === "stop"` events, asks the user to trigger a stop in Linear, and branches the implementation. The plan codifies both branches: (A) teamId is on the stop event → route directly via registry; (B) teamId is absent → maintain a `Map<sessionId, teamId>` populated when the session was first spawned, and consult it on stop. The committed code is whichever branch the live trace selects.
3. **Existing test file `webhook.test.ts` exports `verifySignature, getAutoReactConfig, classifyIssueEvent, createDebouncedHeartbeat`.** New routing tests live in a separate file `webhook.routing.test.ts` so the existing tests stay isolated and easy to read.
4. **Package version bump.** Live `package.json` is at `1.5.0`. The plan bumps to `1.7.0` as instructed (skipping 1.6 because feature scope is large enough to warrant a minor jump signalling multi-repo architecture).
5. **`webhook.ts` already imports `readFileSync` and `join` (lines 4-5), and `getConfiguredTeamId` plus `readConfigRaw` already exist** (lines 8-22). Task 9 removes both since registry lookup makes them dead code.
6. **`auth.ts` exports `AGENT_DIR` and `TOKEN_PATH`** (lines 11-12, 225). Both become module-level constants pointing at the global home in Task 6; downstream consumers continue to import `TOKEN_PATH` (no breakage).

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `mcp/linear-agent/src/registry.ts` | Create | Global teamId → repo registry with atomic write + lockfile |
| `mcp/linear-agent/src/repo-context.ts` | Create | `RepoContext` interface + `extractTeamId(event)` helper |
| `mcp/linear-agent/src/__tests__/registry.test.ts` | Create | Registry unit tests |
| `mcp/linear-agent/src/__tests__/repo-context.test.ts` | Create | Event-shape extraction tests |
| `mcp/linear-agent/src/__tests__/webhook.routing.test.ts` | Create | Multi-repo routing tests |
| `mcp/linear-agent/src/__tests__/auth.test.ts` | Create | Token-hoisting + caching tests |
| `mcp/linear-agent/src/__tests__/oauth.test.ts` | Create | OAuth state HMAC tests |
| `mcp/linear-agent/src/spawn.ts` | Modify | `spawnClaudeSession(event, ctx, opts?)` accepts `RepoContext` |
| `mcp/linear-agent/src/webhook.ts` | Modify | Registry-based routing, per-team debouncers, stop-signal RepoContext |
| `mcp/linear-agent/src/server.ts` | Modify | PID file at `~/.scottclip/server-<port>.pid` |
| `mcp/linear-agent/src/env.ts` | Modify | Load `~/.scottclip/.env` first, fallback to per-repo legacy |
| `mcp/linear-agent/src/auth.ts` | Modify | `AGENT_DIR` → `~/.scottclip/`, migration on first read |
| `mcp/linear-agent/src/oauth.ts` | Modify | Verify signed state on callback, persist token globally, write registry |
| `mcp/linear-agent/src/tools/teams.ts` | Modify | Expose new `linear_get_organization` MCP tool |
| `mcp/linear-agent/.env.example` | Modify | Show only global keys |
| `mcp/linear-agent/package.json` | Modify | Version bump to 1.7.0 |
| `skills/init/SKILL.md` | Modify | Multi-repo aware Phase 0/1.5/2 |
| `CLAUDE.md` | Modify | Note global home in architecture section |

---

## Naming Conventions (used consistently across all tasks)

- **Type:** `RepoContext` — single TypeScript interface in `src/repo-context.ts`.
- **Type fields:** `teamId: string`, `cwd: string`, `configPath: string`, `organizationId: string`.
- **Registry entry type:** `RegistryEntry` extends RepoContext with `registeredAt: string` and `lastEventAt: string | null`.
- **Registry root type:** `RegistryFile = { version: 1, teams: Record<string, RegistryEntry> }`.
- **Module functions:** `register(entry)`, `lookup(teamId)`, `list()`, `remove(teamId)`, `touch(teamId)` (updates `lastEventAt`).
- **Helper:** `extractTeamId(event)` returns `string | null`.
- **Env var for home override:** `SCOTTCLIP_HOME` (default `path.join(os.homedir(), ".scottclip")`).
- **Spawn signature:** `spawnClaudeSession(event: Record<string, unknown>, ctx: RepoContext, opts?: { sessionMap?: Map<string, string> }): Promise<void>`.
- **Debouncer registry inside webhook:** `Map<string, DebouncedHeartbeat>` keyed by `teamId`.

---

### Task 1: Create the registry module (TDD)

**Files:**
- Create: `mcp/linear-agent/src/registry.ts`
- Create: `mcp/linear-agent/src/__tests__/registry.test.ts`

- [ ] **Step 1: Write failing test for empty registry**

Create `mcp/linear-agent/src/__tests__/registry.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let homeDir: string;

beforeEach(() => {
  homeDir = mkdtempSync(join(tmpdir(), "sc-registry-"));
  process.env.SCOTTCLIP_HOME = homeDir;
});

afterEach(() => {
  delete process.env.SCOTTCLIP_HOME;
  rmSync(homeDir, { recursive: true, force: true });
});

describe("registry — empty state", () => {
  it("list() returns empty array when registry file does not exist", async () => {
    const { list } = await import("../registry.js");
    expect(list()).toEqual([]);
  });

  it("lookup() returns null for unknown teamId", async () => {
    const { lookup } = await import("../registry.js");
    expect(lookup("team-does-not-exist")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test (expect fail — module missing)**

Run: `cd mcp/linear-agent && npx vitest run src/__tests__/registry.test.ts`
Expected output: `Failed to load url ../registry.js` (or similar — module not found).

- [ ] **Step 3: Implement minimal module to pass**

Create `mcp/linear-agent/src/registry.ts`:

```typescript
import {
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  unlinkSync,
  readFileSync,
  writeFileSync,
  renameSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface RegistryEntry {
  teamId: string;
  cwd: string;
  configPath: string;
  organizationId: string;
  registeredAt: string;
  lastEventAt: string | null;
}

export interface RegistryFile {
  version: 1;
  teams: Record<string, RegistryEntry>;
}

function home(): string {
  return process.env.SCOTTCLIP_HOME || join(homedir(), ".scottclip");
}

function registryPath(): string {
  return join(home(), "registry.json");
}

function lockPath(): string {
  return join(home(), "registry.lock");
}

let cache: { data: RegistryFile; mtimeMs: number } | null = null;

function ensureHome(): void {
  const dir = home();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

function readNow(): RegistryFile {
  const path = registryPath();
  if (!existsSync(path)) {
    return { version: 1, teams: {} };
  }
  const stat = statSync(path);
  if (cache && cache.mtimeMs === stat.mtimeMs) {
    return cache.data;
  }
  const raw = readFileSync(path, "utf-8");
  const data = JSON.parse(raw) as RegistryFile;
  cache = { data, mtimeMs: stat.mtimeMs };
  return data;
}

const LOCK_TTL_MS = 5000;

function acquireLock(): number {
  ensureHome();
  const lp = lockPath();
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      return openSync(lp, "wx");
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw err;
      // Stale lock check
      try {
        const stat = statSync(lp);
        if (Date.now() - stat.mtimeMs > LOCK_TTL_MS) {
          unlinkSync(lp);
          continue;
        }
      } catch {
        // Lock disappeared between check and stat — retry
        continue;
      }
      // Busy — sleep 100ms via blocking spinwait
      const start = Date.now();
      while (Date.now() - start < 100) {
        // intentional spin for sync API
      }
    }
  }
  throw new Error(`Could not acquire registry lock at ${lp} after 50 attempts`);
}

function releaseLock(fd: number): void {
  try {
    closeSync(fd);
  } catch {
    // ignore
  }
  try {
    unlinkSync(lockPath());
  } catch {
    // ignore
  }
}

function writeAtomic(data: RegistryFile): void {
  ensureHome();
  const path = registryPath();
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  renameSync(tmp, path);
  cache = null;
}

export function list(): RegistryEntry[] {
  return Object.values(readNow().teams);
}

export function lookup(teamId: string): RegistryEntry | null {
  return readNow().teams[teamId] ?? null;
}

export function register(entry: Omit<RegistryEntry, "registeredAt" | "lastEventAt"> & {
  registeredAt?: string;
  lastEventAt?: string | null;
}): RegistryEntry {
  const fd = acquireLock();
  try {
    const data = readNow();
    const now = new Date().toISOString();
    const existing = data.teams[entry.teamId];
    const merged: RegistryEntry = {
      teamId: entry.teamId,
      cwd: entry.cwd,
      configPath: entry.configPath,
      organizationId: entry.organizationId,
      registeredAt: existing?.registeredAt ?? entry.registeredAt ?? now,
      lastEventAt: entry.lastEventAt ?? existing?.lastEventAt ?? null,
    };
    const next: RegistryFile = {
      version: 1,
      teams: { ...data.teams, [entry.teamId]: merged },
    };
    writeAtomic(next);
    return merged;
  } finally {
    releaseLock(fd);
  }
}

export function remove(teamId: string): void {
  const fd = acquireLock();
  try {
    const data = readNow();
    if (!data.teams[teamId]) return;
    const { [teamId]: _, ...rest } = data.teams;
    writeAtomic({ version: 1, teams: rest });
  } finally {
    releaseLock(fd);
  }
}

export function touch(teamId: string): void {
  const fd = acquireLock();
  try {
    const data = readNow();
    const entry = data.teams[teamId];
    if (!entry) return;
    const next: RegistryFile = {
      version: 1,
      teams: {
        ...data.teams,
        [teamId]: { ...entry, lastEventAt: new Date().toISOString() },
      },
    };
    writeAtomic(next);
  } finally {
    releaseLock(fd);
  }
}
```

- [ ] **Step 4: Run test (expect pass)**

Run: `cd mcp/linear-agent && npx vitest run src/__tests__/registry.test.ts`
Expected output: `2 passed` for the empty-state suite.

- [ ] **Step 5: Add register-then-lookup test**

Append to `registry.test.ts`:

```typescript
describe("registry — register/lookup", () => {
  it("register persists an entry and lookup returns it", async () => {
    const { register, lookup } = await import("../registry.js");
    const entry = register({
      teamId: "team-a",
      cwd: "/repo/a",
      configPath: "/repo/a/.scottclip/config.yaml",
      organizationId: "org-1",
    });
    expect(entry.teamId).toBe("team-a");
    expect(typeof entry.registeredAt).toBe("string");
    expect(entry.lastEventAt).toBeNull();

    const found = lookup("team-a");
    expect(found).not.toBeNull();
    expect(found!.cwd).toBe("/repo/a");
    expect(found!.organizationId).toBe("org-1");
  });

  it("registry file is created with mode 0600", async () => {
    const { register } = await import("../registry.js");
    register({
      teamId: "team-a",
      cwd: "/repo/a",
      configPath: "/repo/a/.scottclip/config.yaml",
      organizationId: "org-1",
    });
    const stat = (await import("node:fs")).statSync(join(homeDir, "registry.json"));
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it("re-registering same teamId preserves registeredAt and updates fields", async () => {
    const { register, lookup } = await import("../registry.js");
    const first = register({
      teamId: "team-a",
      cwd: "/repo/a",
      configPath: "/repo/a/.scottclip/config.yaml",
      organizationId: "org-1",
    });
    await new Promise((r) => setTimeout(r, 10));
    register({
      teamId: "team-a",
      cwd: "/repo/a-renamed",
      configPath: "/repo/a-renamed/.scottclip/config.yaml",
      organizationId: "org-1",
    });
    const found = lookup("team-a")!;
    expect(found.cwd).toBe("/repo/a-renamed");
    expect(found.registeredAt).toBe(first.registeredAt);
  });
});
```

- [ ] **Step 6: Run test (expect pass)**

Run: `cd mcp/linear-agent && npx vitest run src/__tests__/registry.test.ts`
Expected output: `5 passed`.

- [ ] **Step 7: Add concurrent-register test**

Append to `registry.test.ts`:

```typescript
describe("registry — concurrency", () => {
  it("two parallel registers both land", async () => {
    const { register, list } = await import("../registry.js");
    await Promise.all([
      Promise.resolve(register({
        teamId: "team-a",
        cwd: "/repo/a",
        configPath: "/repo/a/.scottclip/config.yaml",
        organizationId: "org-1",
      })),
      Promise.resolve(register({
        teamId: "team-b",
        cwd: "/repo/b",
        configPath: "/repo/b/.scottclip/config.yaml",
        organizationId: "org-1",
      })),
    ]);
    const entries = list();
    expect(entries.map((e) => e.teamId).sort()).toEqual(["team-a", "team-b"]);
  });

  it("stale lock (>5s old) is taken over", async () => {
    const fs = await import("node:fs");
    const lp = join(homeDir, "registry.lock");
    // Create stale lockfile with old mtime
    fs.writeFileSync(lp, String(99999));
    const tenSecAgo = new Date(Date.now() - 10000);
    fs.utimesSync(lp, tenSecAgo, tenSecAgo);

    const { register, lookup } = await import("../registry.js");
    register({
      teamId: "team-a",
      cwd: "/repo/a",
      configPath: "/repo/a/.scottclip/config.yaml",
      organizationId: "org-1",
    });
    expect(lookup("team-a")).not.toBeNull();
  });

  it("remove() deletes a team entry", async () => {
    const { register, remove, lookup } = await import("../registry.js");
    register({
      teamId: "team-a",
      cwd: "/repo/a",
      configPath: "/repo/a/.scottclip/config.yaml",
      organizationId: "org-1",
    });
    remove("team-a");
    expect(lookup("team-a")).toBeNull();
  });

  it("touch() updates lastEventAt", async () => {
    const { register, touch, lookup } = await import("../registry.js");
    register({
      teamId: "team-a",
      cwd: "/repo/a",
      configPath: "/repo/a/.scottclip/config.yaml",
      organizationId: "org-1",
    });
    expect(lookup("team-a")!.lastEventAt).toBeNull();
    touch("team-a");
    expect(lookup("team-a")!.lastEventAt).not.toBeNull();
  });
});
```

- [ ] **Step 8: Run all registry tests (expect pass)**

Run: `cd mcp/linear-agent && npx vitest run src/__tests__/registry.test.ts`
Expected output: `9 passed`.

- [ ] **Step 9: Build to confirm no type errors**

Run: `cd mcp/linear-agent && npm run build`
Expected output: clean compile (no new errors beyond the pre-existing SDK import error documented in prior plans).

- [ ] **Step 10: Commit**

```bash
git add plugins/scottclip/mcp/linear-agent/src/registry.ts plugins/scottclip/mcp/linear-agent/src/__tests__/registry.test.ts
git commit -m "feat(registry): add global teamId registry with atomic write and lockfile"
```

---

### Task 2: TeamId extraction helper + RepoContext type (TDD)

**Files:**
- Create: `mcp/linear-agent/src/repo-context.ts`
- Create: `mcp/linear-agent/src/__tests__/repo-context.test.ts`

- [ ] **Step 1: Write failing test**

Create `mcp/linear-agent/src/__tests__/repo-context.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { extractTeamId } from "../repo-context.js";

describe("extractTeamId", () => {
  it("reads agentSession.issue.teamId (Linear AgentSessionEvent shape)", () => {
    const event = {
      type: "AgentSessionEvent",
      action: "created",
      agentSession: { id: "s1", issue: { id: "i1", teamId: "team-a" } },
    };
    expect(extractTeamId(event)).toBe("team-a");
  });

  it("reads agentSession.issue.team.id (nested team object)", () => {
    const event = {
      type: "AgentSessionEvent",
      agentSession: { id: "s1", issue: { id: "i1", team: { id: "team-a" } } },
    };
    expect(extractTeamId(event)).toBe("team-a");
  });

  it("reads data.issue.teamId (synthetic event shape)", () => {
    const event = {
      type: "AgentSessionEvent",
      data: { id: "s1", issue: { id: "i1", teamId: "team-a" } },
    };
    expect(extractTeamId(event)).toBe("team-a");
  });

  it("reads data.teamId (Linear Issue webhook shape)", () => {
    const event = {
      type: "Issue",
      action: "create",
      data: { id: "i1", teamId: "team-a" },
    };
    expect(extractTeamId(event)).toBe("team-a");
  });

  it("returns null when no teamId field present", () => {
    const event = { type: "Issue", action: "create", data: { id: "i1" } };
    expect(extractTeamId(event)).toBeNull();
  });

  it("returns null for empty event", () => {
    expect(extractTeamId({})).toBeNull();
  });

  it("prefers agentSession.issue.teamId over data.teamId when both present", () => {
    const event = {
      agentSession: { issue: { teamId: "team-from-session" } },
      data: { teamId: "team-from-data" },
    };
    expect(extractTeamId(event)).toBe("team-from-session");
  });
});
```

- [ ] **Step 2: Run test (expect fail — module missing)**

Run: `cd mcp/linear-agent && npx vitest run src/__tests__/repo-context.test.ts`
Expected output: `Failed to load url ../repo-context.js`.

- [ ] **Step 3: Implement minimal module to pass**

Create `mcp/linear-agent/src/repo-context.ts`:

```typescript
export interface RepoContext {
  teamId: string;
  cwd: string;
  configPath: string;
  organizationId: string;
}

export function extractTeamId(event: Record<string, unknown>): string | null {
  const agentSession = event.agentSession as Record<string, unknown> | undefined;
  const data = event.data as Record<string, unknown> | undefined;

  // 1. AgentSessionEvent: agentSession.issue.teamId
  const sessionIssue = agentSession?.issue as Record<string, unknown> | undefined;
  if (typeof sessionIssue?.teamId === "string") return sessionIssue.teamId;

  // 2. AgentSessionEvent with nested team: agentSession.issue.team.id
  const sessionIssueTeam = sessionIssue?.team as Record<string, unknown> | undefined;
  if (typeof sessionIssueTeam?.id === "string") return sessionIssueTeam.id;

  // 3. Synthetic event: data.issue.teamId
  const dataIssue = data?.issue as Record<string, unknown> | undefined;
  if (typeof dataIssue?.teamId === "string") return dataIssue.teamId;

  // 4. Issue webhook: data.teamId
  if (typeof data?.teamId === "string") return data.teamId;

  return null;
}
```

- [ ] **Step 4: Run test (expect pass)**

Run: `cd mcp/linear-agent && npx vitest run src/__tests__/repo-context.test.ts`
Expected output: `7 passed`.

- [ ] **Step 5: Build**

Run: `cd mcp/linear-agent && npm run build`
Expected output: clean compile.

- [ ] **Step 6: Commit**

```bash
git add plugins/scottclip/mcp/linear-agent/src/repo-context.ts plugins/scottclip/mcp/linear-agent/src/__tests__/repo-context.test.ts
git commit -m "feat(repo-context): add RepoContext interface and extractTeamId helper"
```

---

### Task 3: Refactor spawn signature to accept RepoContext (no behaviour change)

**Files:**
- Modify: `mcp/linear-agent/src/spawn.ts:205-210` (current entry point)
- Modify: `mcp/linear-agent/src/spawn.ts:233` (uses `targetRepo`)
- Modify: `mcp/linear-agent/src/spawn.ts:247` (passes `cwd: targetRepo` to claude SDK)
- Modify: `mcp/linear-agent/src/webhook.ts:143` (calls `spawnClaudeSession(syntheticEvent)` from auto-react debouncer)
- Modify: `mcp/linear-agent/src/webhook.ts:231` (calls `spawnClaudeSession(event)` from AgentSessionEvent handler)

Verified call sites (read live before this task):
- `spawn.ts:205` — `export async function spawnClaudeSession(event: Record<string, unknown>): Promise<void>`
- `spawn.ts:206` — `const targetRepo = process.env.AGENT_CWD;`
- `spawn.ts:208-210` — early return if `!targetRepo`
- `spawn.ts:233` — `const sessionsDir = join(targetRepo, ".scottclip", "sessions");`
- `spawn.ts:247` — `cwd: targetRepo,` inside the `query()` options
- `webhook.ts:143` — `spawnClaudeSession(syntheticEvent)`
- `webhook.ts:231` — `spawnClaudeSession(event).catch(...)`

- [ ] **Step 1: Write failing test**

Create `mcp/linear-agent/src/__tests__/spawn-signature.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import type { RepoContext } from "../repo-context.js";

describe("spawnClaudeSession signature", () => {
  it("accepts (event, ctx) without TypeScript errors at runtime", async () => {
    const { spawnClaudeSession } = await import("../spawn.js");
    expect(typeof spawnClaudeSession).toBe("function");
    // Function arity must be 2 (event, ctx) — opts is optional with default
    expect(spawnClaudeSession.length).toBe(2);
  });

  it("RepoContext shape is consumed (type-level smoke test)", () => {
    const ctx: RepoContext = {
      teamId: "team-a",
      cwd: "/repo/a",
      configPath: "/repo/a/.scottclip/config.yaml",
      organizationId: "org-1",
    };
    expect(ctx.teamId).toBe("team-a");
  });
});
```

- [ ] **Step 2: Run test (expect fail — arity is currently 1)**

Run: `cd mcp/linear-agent && npx vitest run src/__tests__/spawn-signature.test.ts`
Expected output: arity assertion fails (current `spawnClaudeSession` arity is 1).

- [ ] **Step 3: Update `spawn.ts`**

Edit `mcp/linear-agent/src/spawn.ts`. Add import at the top of the file (after the existing imports on lines 1-4):

```typescript
import type { RepoContext } from "./repo-context.js";
```

Replace the current signature at line 205-210:

```typescript
export async function spawnClaudeSession(event: Record<string, unknown>): Promise<void> {
  const targetRepo = process.env.AGENT_CWD;
  if (!targetRepo) {
    console.error("AGENT_CWD not set — cannot spawn Claude session");
    return;
  }
```

with:

```typescript
export async function spawnClaudeSession(
  event: Record<string, unknown>,
  ctx: RepoContext,
  opts: { sessionMap?: Map<string, string> } = {},
): Promise<void> {
  const targetRepo = ctx.cwd;
  if (!targetRepo) {
    console.error("RepoContext.cwd missing — cannot spawn Claude session");
    return;
  }
```

The body continues unchanged — `targetRepo` (line 233 `sessionsDir`, line 247 `cwd`) keeps the same name and now refers to `ctx.cwd`.

After the existing `const sessionId = (session?.id || "unknown") as string;` line (currently line 216), insert:

```typescript
  // Track sessionId → teamId so the stop handler can route without re-extraction
  if (opts.sessionMap && sessionId !== "unknown") {
    opts.sessionMap.set(sessionId, ctx.teamId);
  }
```

- [ ] **Step 4: Update both webhook.ts call sites to build a temporary RepoContext from legacy env**

In `mcp/linear-agent/src/webhook.ts`, add at the top of the file (after the existing imports on lines 1-6):

```typescript
import type { RepoContext } from "./repo-context.js";
```

Add a helper above `createWebhookRoute` (after the `verifySignature` function, around current line 122):

```typescript
function legacyContext(): RepoContext {
  const cwd = process.env.AGENT_CWD || process.cwd();
  return {
    teamId: "legacy",
    cwd,
    configPath: join(cwd, ".scottclip", "config.yaml"),
    organizationId: "legacy",
  };
}
```

Replace the auto-react debouncer call at line 143:

```typescript
      spawnClaudeSession(syntheticEvent)
        .catch((err) => console.error("Auto-react spawn error:", err))
        .finally(() => debouncer.setRunning(false));
```

with:

```typescript
      spawnClaudeSession(syntheticEvent, legacyContext())
        .catch((err) => console.error("Auto-react spawn error:", err))
        .finally(() => debouncer.setRunning(false));
```

Replace the AgentSessionEvent call at line 231:

```typescript
          spawnClaudeSession(event).catch((err) => console.error("Spawn error:", err));
```

with:

```typescript
          spawnClaudeSession(event, legacyContext()).catch((err) => console.error("Spawn error:", err));
```

- [ ] **Step 5: Run all tests (expect pass)**

Run: `cd mcp/linear-agent && npx vitest run`
Expected output: every existing test still passes; new signature test passes; total count increases by 2.

- [ ] **Step 6: Build**

Run: `cd mcp/linear-agent && npm run build`
Expected output: clean compile.

- [ ] **Step 7: Commit**

```bash
git add plugins/scottclip/mcp/linear-agent/src/spawn.ts plugins/scottclip/mcp/linear-agent/src/webhook.ts plugins/scottclip/mcp/linear-agent/src/__tests__/spawn-signature.test.ts
git commit -m "refactor(spawn): thread RepoContext through spawnClaudeSession"
```

---

### Task 4: Wire registry into webhook routing (the MVP)

**Files:**
- Modify: `mcp/linear-agent/src/webhook.ts:124-263` (the entire `createWebhookRoute` body)
- Create: `mcp/linear-agent/src/__tests__/webhook.routing.test.ts`

Verified call sites (read live before this task):
- `webhook.ts:128-147` — single global `debouncer` declared once before `app.post`
- `webhook.ts:167-233` — AgentSessionEvent handler reads `process.env.AGENT_CWD` at line 183 (stop signal) and calls `getConfiguredTeamId()` at line 200
- `webhook.ts:236-253` — Issue handler calls `getConfiguredTeamId()` at line 240
- `repo-context.ts` (Task 2) — `extractTeamId(event)`
- `registry.ts` (Task 1) — `lookup(teamId)`

#### Step 1: Add temporary stop-signal logging (Q2 instrumentation)

- [ ] **Step 1.1: Add temp log inside the stop branch**

In `mcp/linear-agent/src/webhook.ts`, locate the stop signal branch (currently lines 180-197). At the top of the `if (signal === "stop")` block, immediately after `console.log(\`Stop signal received for session ${sessionId}\`);`, add:

```typescript
          // Q2 INSTRUMENTATION — REMOVE BEFORE COMMITTING TASK 4 STEP 4
          console.log("STOP_EVENT_PAYLOAD:", JSON.stringify(event, null, 2));
```

- [ ] **Step 1.2: Build and ask user to trigger a stop**

Run: `cd mcp/linear-agent && npm run build`
Expected output: clean compile.

Ask the user (in the implementing session): *"Run `npm run start`, then trigger an AgentSessionEvent stop signal in Linear (cancel a running session in your Linear UI), then paste the full STOP_EVENT_PAYLOAD line from the server stdout."*

- [ ] **Step 1.3: Branch decision**

Inspect the pasted payload:
- **Branch A:** payload contains `agentSession.issue.teamId` (or `agentSession.issue.team.id`) → `extractTeamId(event)` already returns the right value on stop. Use the registry path directly.
- **Branch B:** payload does NOT contain a teamId on stop → maintain a `Map<sessionId, teamId>` populated when the session was first spawned (created/prompted). On stop, look up the map. The map is created at module scope inside `createWebhookRoute`.

Document the chosen branch in the commit message body.

#### Step 2: Write failing routing tests

- [ ] **Step 2.1: Create routing test file**

Create `mcp/linear-agent/src/__tests__/webhook.routing.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHmac } from "node:crypto";

// Mock spawn to assert it was called with the right RepoContext
vi.mock("../spawn.js", () => ({
  ackSession: vi.fn().mockResolvedValue(undefined),
  spawnClaudeSession: vi.fn().mockResolvedValue(undefined),
  moveIssueToState: vi.fn().mockResolvedValue(undefined),
}));

let homeDir: string;
const SECRET = "test-secret-12345";

function sign(body: string): string {
  return createHmac("sha256", SECRET).update(body).digest("hex");
}

beforeEach(() => {
  homeDir = mkdtempSync(join(tmpdir(), "sc-routing-"));
  process.env.SCOTTCLIP_HOME = homeDir;
  process.env.LINEAR_WEBHOOK_SECRET = SECRET;
  vi.resetModules();
  vi.clearAllMocks();
});

afterEach(() => {
  delete process.env.SCOTTCLIP_HOME;
  delete process.env.LINEAR_WEBHOOK_SECRET;
  delete process.env.AGENT_CWD;
  rmSync(homeDir, { recursive: true, force: true });
});

describe("webhook routing — registry mode", () => {
  it("routes known team to its registered cwd", async () => {
    const { register } = await import("../registry.js");
    register({
      teamId: "team-a",
      cwd: "/repo/a",
      configPath: "/repo/a/.scottclip/config.yaml",
      organizationId: "org-1",
    });

    const { createWebhookRoute } = await import("../webhook.js");
    const { spawnClaudeSession } = await import("../spawn.js");
    const app = createWebhookRoute();

    const body = JSON.stringify({
      type: "AgentSessionEvent",
      action: "created",
      agentSession: { id: "s1", issue: { id: "i1", teamId: "team-a" } },
    });

    const res = await app.fetch(
      new Request("http://localhost/", {
        method: "POST",
        headers: { "linear-signature": sign(body) },
        body,
      }),
    );

    expect(res.status).toBe(200);
    // Allow async work to flush
    await new Promise((r) => setTimeout(r, 10));
    expect(spawnClaudeSession).toHaveBeenCalledTimes(1);
    const ctx = (spawnClaudeSession as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(ctx.teamId).toBe("team-a");
    expect(ctx.cwd).toBe("/repo/a");
  });

  it("returns 200 silent for unknown team when registry exists", async () => {
    const { register } = await import("../registry.js");
    register({
      teamId: "team-a",
      cwd: "/repo/a",
      configPath: "/repo/a/.scottclip/config.yaml",
      organizationId: "org-1",
    });

    const { createWebhookRoute } = await import("../webhook.js");
    const { spawnClaudeSession } = await import("../spawn.js");
    const app = createWebhookRoute();

    const body = JSON.stringify({
      type: "AgentSessionEvent",
      action: "created",
      agentSession: { id: "s1", issue: { id: "i1", teamId: "team-unknown" } },
    });

    const res = await app.fetch(
      new Request("http://localhost/", {
        method: "POST",
        headers: { "linear-signature": sign(body) },
        body,
      }),
    );

    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 10));
    expect(spawnClaudeSession).not.toHaveBeenCalled();
  });

  it("returns 200 silent when teamId is missing from event", async () => {
    const { register } = await import("../registry.js");
    register({
      teamId: "team-a",
      cwd: "/repo/a",
      configPath: "/repo/a/.scottclip/config.yaml",
      organizationId: "org-1",
    });

    const { createWebhookRoute } = await import("../webhook.js");
    const { spawnClaudeSession } = await import("../spawn.js");
    const app = createWebhookRoute();

    const body = JSON.stringify({
      type: "AgentSessionEvent",
      action: "created",
      agentSession: { id: "s1" },
    });

    const res = await app.fetch(
      new Request("http://localhost/", {
        method: "POST",
        headers: { "linear-signature": sign(body) },
        body,
      }),
    );

    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 10));
    expect(spawnClaudeSession).not.toHaveBeenCalled();
  });
});

describe("webhook routing — legacy fallback", () => {
  it("uses AGENT_CWD when registry file does not exist", async () => {
    process.env.AGENT_CWD = "/legacy/repo";
    const { createWebhookRoute } = await import("../webhook.js");
    const { spawnClaudeSession } = await import("../spawn.js");
    const app = createWebhookRoute();

    const body = JSON.stringify({
      type: "AgentSessionEvent",
      action: "created",
      agentSession: { id: "s1", issue: { id: "i1", teamId: "team-anything" } },
    });

    const res = await app.fetch(
      new Request("http://localhost/", {
        method: "POST",
        headers: { "linear-signature": sign(body) },
        body,
      }),
    );

    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 10));
    expect(spawnClaudeSession).toHaveBeenCalledTimes(1);
    const ctx = (spawnClaudeSession as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(ctx.cwd).toBe("/legacy/repo");
    expect(ctx.teamId).toBe("legacy");
  });
});

describe("webhook routing — per-team debouncer", () => {
  it("creates a separate debouncer instance per teamId", async () => {
    const { register } = await import("../registry.js");
    // Two repos with auto_react config files
    for (const teamId of ["team-a", "team-b"]) {
      const cwd = join(homeDir, teamId);
      mkdirSync(join(cwd, ".scottclip"), { recursive: true });
      writeFileSync(
        join(cwd, ".scottclip", "config.yaml"),
        "version: 2\nmonitor:\n  auto_react: true\n  quiet_window_s: 30\n",
      );
      register({
        teamId,
        cwd,
        configPath: join(cwd, ".scottclip", "config.yaml"),
        organizationId: "org-1",
      });
    }

    const { createWebhookRoute } = await import("../webhook.js");
    const { spawnClaudeSession } = await import("../spawn.js");
    vi.useFakeTimers();
    const app = createWebhookRoute();

    const issueBody = (teamId: string, issueId: string) =>
      JSON.stringify({
        type: "Issue",
        action: "create",
        actor: { type: "user", name: "Scott" },
        data: { id: issueId, teamId },
      });

    const ba = issueBody("team-a", "ia");
    const bb = issueBody("team-b", "ib");
    await app.fetch(new Request("http://localhost/", { method: "POST", headers: { "linear-signature": sign(ba) }, body: ba }));
    await app.fetch(new Request("http://localhost/", { method: "POST", headers: { "linear-signature": sign(bb) }, body: bb }));

    vi.advanceTimersByTime(30000);
    await vi.runAllTimersAsync();

    expect(spawnClaudeSession).toHaveBeenCalledTimes(2);
    const ctxs = (spawnClaudeSession as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[1]);
    expect(ctxs.map((c) => c.teamId).sort()).toEqual(["team-a", "team-b"]);
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2.2: Run tests (expect fail — routing not yet wired)**

Run: `cd mcp/linear-agent && npx vitest run src/__tests__/webhook.routing.test.ts`
Expected output: assertions about `ctx.teamId === "team-a"` fail because current code passes `legacyContext()` regardless.

#### Step 3: Implement registry-based routing

- [ ] **Step 3.1: Update webhook.ts imports**

In `mcp/linear-agent/src/webhook.ts`, add to the imports at the top (after the existing import on line 6):

```typescript
import { lookup as registryLookup, list as registryList, touch as registryTouch } from "./registry.js";
import { extractTeamId } from "./repo-context.js";
import { readFileSync as readFileSyncForCtx } from "node:fs";
```

- [ ] **Step 3.2: Add a context-builder helper**

Add directly above `createWebhookRoute` (replacing the `legacyContext()` helper from Task 3):

```typescript
function buildRepoContext(event: Record<string, unknown>): RepoContext | "unknown-team" | "no-team-id" {
  const teamId = extractTeamId(event);
  const registryPopulated = registryList().length > 0;

  if (registryPopulated) {
    if (!teamId) return "no-team-id";
    const entry = registryLookup(teamId);
    if (!entry) return "unknown-team";
    registryTouch(teamId);
    return {
      teamId: entry.teamId,
      cwd: entry.cwd,
      configPath: entry.configPath,
      organizationId: entry.organizationId,
    };
  }

  // Legacy fallback — registry empty/missing
  const cwd = process.env.AGENT_CWD || process.cwd();
  return {
    teamId: "legacy",
    cwd,
    configPath: join(cwd, ".scottclip", "config.yaml"),
    organizationId: "legacy",
  };
}
```

- [ ] **Step 3.3: Replace the global debouncer with a per-team Map**

Inside `createWebhookRoute`, replace the existing single-debouncer declaration (current lines 128-147) with:

```typescript
  // Per-team auto-react debouncers
  const debouncers = new Map<string, DebouncedHeartbeat>();
  // sessionId → teamId map for stop-signal routing (used only if Branch B)
  const sessionTeamMap = new Map<string, string>();

  function getDebouncer(ctx: RepoContext): DebouncedHeartbeat {
    const existing = debouncers.get(ctx.teamId);
    if (existing) return existing;
    const cfgRaw = (() => {
      try { return readFileSyncForCtx(ctx.configPath, "utf-8"); } catch { return undefined; }
    })();
    const cfg = getAutoReactConfig(cfgRaw);
    const d = createDebouncedHeartbeat(cfg.quietWindowS, (eventCount) => {
      console.log(`Auto-react[${ctx.teamId}]: firing heartbeat (${eventCount} events in window)`);
      d.setRunning(true);
      const syntheticEvent: Record<string, unknown> = {
        type: "AutoReactHeartbeat",
        action: "created",
        data: { id: `auto-react-${Date.now()}`, issueIdentifier: "heartbeat" },
        guidance: "Auto-react triggered by Issue webhook events. Run a heartbeat cycle: pick up issues from the inbox, triage unlabeled ones, dispatch to personas.",
        promptContext: `Triggered by ${eventCount} Issue event(s) for team ${ctx.teamId}.`,
      };
      spawnClaudeSession(syntheticEvent, ctx, { sessionMap: sessionTeamMap })
        .catch((err) => console.error("Auto-react spawn error:", err))
        .finally(() => d.setRunning(false));
    });
    debouncers.set(ctx.teamId, d);
    return d;
  }
```

- [ ] **Step 3.4: Rewrite the AgentSessionEvent block (current lines 167-233)**

Replace the entire `if (event.type === "AgentSessionEvent") { ... }` block with:

```typescript
      if (event.type === "AgentSessionEvent") {
        const sessionData = event.agentSession || event.data;
        if (!sessionData?.id) return response;
        const sessionId = sessionData.id as string;

        const creatorDebug = sessionData.creator as Record<string, unknown> | undefined;
        if (creatorDebug) {
          console.log(`Session ${sessionId} creator: ${JSON.stringify({ id: creatorDebug.id, name: creatorDebug.name, isBot: creatorDebug.isBot, type: creatorDebug.type })}`);
        }

        // Stop signal — route via registry OR sessionTeamMap depending on Branch chosen in Step 1.3
        const signal = event.agentActivity?.signal;
        if (signal === "stop") {
          console.log(`Stop signal received for session ${sessionId}`);
          // Branch A: teamId was on the event → buildRepoContext works directly.
          // Branch B: fall back to sessionTeamMap.
          let ctxOrSentinel: RepoContext | "unknown-team" | "no-team-id" = buildRepoContext(event);
          if (ctxOrSentinel === "no-team-id") {
            const mapped = sessionTeamMap.get(sessionId);
            if (mapped) {
              const entry = registryLookup(mapped);
              if (entry) ctxOrSentinel = { teamId: entry.teamId, cwd: entry.cwd, configPath: entry.configPath, organizationId: entry.organizationId };
            }
          }
          if (typeof ctxOrSentinel === "string") {
            console.log(`Stop signal for ${sessionId}: cannot resolve team (${ctxOrSentinel}) — ignoring`);
            return response;
          }
          const sessionsDir = join(ctxOrSentinel.cwd, ".scottclip", "sessions");
          const sessionFile = join(sessionsDir, `${sessionId}.pid`);
          try {
            const pid = parseInt(await readFile(sessionFile, "utf-8"), 10);
            if (pid) {
              process.kill(pid, "SIGTERM");
              console.log(`Killed session ${sessionId} (PID ${pid})`);
            }
            await unlink(sessionFile);
          } catch {
            console.log(`No active session file for ${sessionId} (may have already finished)`);
          }
          sessionTeamMap.delete(sessionId);
          return response;
        }

        // Skip bot-triggered sessions
        const creator = sessionData.creator as Record<string, unknown> | undefined;
        const creatorIsBot = creator?.isBot === true || creator?.type === "application";
        if (creatorIsBot) {
          console.log(`Ignoring bot-triggered session ${sessionId}`);
          return response;
        }

        // Resolve repo context
        const ctxOrSentinel = buildRepoContext(event);
        if (ctxOrSentinel === "unknown-team") {
          console.log(`Ignoring AgentSessionEvent for unregistered team (session ${sessionId})`);
          return response;
        }
        if (ctxOrSentinel === "no-team-id") {
          console.log(`Ignoring AgentSessionEvent without teamId (session ${sessionId})`);
          return response;
        }
        const ctx = ctxOrSentinel;

        if (event.action === "created" || event.action === "prompted") {
          const ackMsg = event.action === "created" ? "Starting up..." : "Reading your message...";
          ackSession(sessionId, ackMsg).catch((err) => console.error("Ack error:", err));

          const issueId = sessionData.issue?.id;
          if (issueId) {
            moveIssueToState(issueId as string, ctx.teamId, "In Progress").catch((err) =>
              console.error("Move to In Progress error:", err),
            );
          }

          spawnClaudeSession(event, ctx, { sessionMap: sessionTeamMap }).catch((err) =>
            console.error("Spawn error:", err),
          );
        }
      }
```

- [ ] **Step 3.5: Rewrite the Issue handler block (current lines 236-253)**

Replace it with:

```typescript
      if (event.type === "Issue") {
        const ctxOrSentinel = buildRepoContext(event);
        if (ctxOrSentinel === "unknown-team" || ctxOrSentinel === "no-team-id") {
          console.log(`Auto-react: ignoring Issue event (${ctxOrSentinel})`);
          return response;
        }
        const ctx = ctxOrSentinel;
        const cfgRaw = (() => {
          try { return readFileSyncForCtx(ctx.configPath, "utf-8"); } catch { return undefined; }
        })();
        const config = getAutoReactConfig(cfgRaw);
        if (config.autoReact) {
          const classification = classifyIssueEvent(event);
          if (classification !== "skip") {
            console.log(`Auto-react[${ctx.teamId}]: ${classification} event, queuing heartbeat`);
            getDebouncer(ctx).queue(`${event.action}-${(event.data as Record<string, unknown>)?.id || "unknown"}`);
          }
        }
      }
```

- [ ] **Step 3.6: Remove the Q2 instrumentation log added in Step 1.1**

Delete the `console.log("STOP_EVENT_PAYLOAD:", ...)` line that was added during instrumentation.

- [ ] **Step 4: Run all tests (expect pass)**

Run: `cd mcp/linear-agent && npx vitest run`
Expected output: every previously-passing test still passes; new `webhook.routing.test.ts` reports `5 passed` (or 4 if Branch B unused, depending on what test you wrote).

- [ ] **Step 5: Build**

Run: `cd mcp/linear-agent && npm run build`
Expected output: clean compile.

- [ ] **Step 6: Commit**

```bash
git add plugins/scottclip/mcp/linear-agent/src/webhook.ts plugins/scottclip/mcp/linear-agent/src/__tests__/webhook.routing.test.ts
git commit -m "$(cat <<'EOF'
feat(webhook): route by teamId via global registry

Webhook handler extracts teamId from the event, looks up the global
registry, and threads RepoContext through spawn and auto-react debouncer.
Falls back to AGENT_CWD when registry is empty (legacy mode).

Stop-signal routing uses [Branch A: extractTeamId from stop event]
[Branch B: sessionId->teamId map populated at spawn time] — based on the
upstream payload shape verified during instrumentation.
EOF
)"
```

(Pick the appropriate Branch A/B sentence and delete the other before committing.)

---

### Task 5: Server-global PID file + global .env

**Files:**
- Modify: `mcp/linear-agent/src/server.ts:115` (PID write path)
- Modify: `mcp/linear-agent/src/server.ts:132` (PID unlink path)
- Modify: `mcp/linear-agent/src/env.ts:31-59` (loadDotEnv)
- Modify: `mcp/linear-agent/src/__tests__/env.test.ts` (add global-load test)

Verified live state:
- `server.ts:115` — `const pidPath = join(process.cwd(), ".scottclip", ".server.pid");`
- `server.ts:132` — same path on shutdown
- `env.ts:32-33` — `const cwd = process.cwd(); const envPath = join(cwd, ".scottclip", ".env");`

- [ ] **Step 1: Write failing test for global env load**

Append to `mcp/linear-agent/src/__tests__/env.test.ts`:

```typescript
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, afterEach } from "vitest";

describe("loadDotEnv — global home", () => {
  let homeDir: string;
  const KEYS = ["LINEAR_CLIENT_ID", "LINEAR_CLIENT_SECRET", "TEST_MARKER"];

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), "sc-env-"));
    process.env.SCOTTCLIP_HOME = homeDir;
    for (const k of KEYS) delete process.env[k];
  });

  afterEach(() => {
    delete process.env.SCOTTCLIP_HOME;
    for (const k of KEYS) delete process.env[k];
    rmSync(homeDir, { recursive: true, force: true });
  });

  it("loads ~/.scottclip/.env when present", async () => {
    writeFileSync(join(homeDir, ".env"), "TEST_MARKER=from_global\n");
    const { loadDotEnv } = await import("../env.js");
    loadDotEnv();
    expect(process.env.TEST_MARKER).toBe("from_global");
  });

  it("global takes precedence over per-repo legacy when both present", async () => {
    writeFileSync(join(homeDir, ".env"), "TEST_MARKER=from_global\n");
    const repoDir = mkdtempSync(join(tmpdir(), "sc-repo-"));
    mkdirSync(join(repoDir, ".scottclip"), { recursive: true });
    writeFileSync(join(repoDir, ".scottclip", ".env"), "TEST_MARKER=from_repo\n");
    const origCwd = process.cwd();
    process.chdir(repoDir);
    try {
      const { loadDotEnv } = await import("../env.js");
      loadDotEnv();
      expect(process.env.TEST_MARKER).toBe("from_global");
    } finally {
      process.chdir(origCwd);
      rmSync(repoDir, { recursive: true, force: true });
    }
  });

  it("falls back to per-repo .scottclip/.env when global missing", async () => {
    const repoDir = mkdtempSync(join(tmpdir(), "sc-repo-"));
    mkdirSync(join(repoDir, ".scottclip"), { recursive: true });
    writeFileSync(join(repoDir, ".scottclip", ".env"), "TEST_MARKER=from_repo\n");
    const origCwd = process.cwd();
    process.chdir(repoDir);
    try {
      const { loadDotEnv } = await import("../env.js");
      loadDotEnv();
      expect(process.env.TEST_MARKER).toBe("from_repo");
    } finally {
      process.chdir(origCwd);
      rmSync(repoDir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run test (expect fail — current loadDotEnv ignores SCOTTCLIP_HOME)**

Run: `cd mcp/linear-agent && npx vitest run src/__tests__/env.test.ts`
Expected output: the three new tests fail (`TEST_MARKER` undefined, or set from repo when global was present).

- [ ] **Step 3: Update `env.ts`**

Replace the body of `loadDotEnv` in `mcp/linear-agent/src/env.ts:31-59`:

```typescript
export function loadDotEnv(): void {
  const homeRoot = process.env.SCOTTCLIP_HOME || join(homedir(), ".scottclip");
  const globalPath = join(homeRoot, ".env");
  const repoPath = join(process.cwd(), ".scottclip", ".env");

  const sources: Array<{ label: string; path: string }> = [
    { label: "global", path: globalPath },
    { label: "repo", path: repoPath },
  ];

  let totalLoaded = 0;
  for (const src of sources) {
    try {
      const content = readFileSync(src.path, "utf-8");
      const vars = parseDotEnv(content);
      let loaded = 0;
      for (const [key, value] of Object.entries(vars)) {
        if (process.env[key] === undefined) {
          process.env[key] = value;
          loaded++;
        }
      }
      if (loaded > 0) {
        console.log(`Loaded ${loaded} env var(s) from ${src.path} (${src.label})`);
        totalLoaded += loaded;
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        console.error(`Error reading ${src.path}:`, err);
      }
    }
  }

  if (totalLoaded === 0) {
    console.log("No .env files found in ~/.scottclip/ or .scottclip/ — relying on process env");
  }
}
```

Add the homedir import at the top of `env.ts`:

```typescript
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
```

- [ ] **Step 4: Run env tests (expect pass)**

Run: `cd mcp/linear-agent && npx vitest run src/__tests__/env.test.ts`
Expected output: `8 passed` (5 original + 3 new).

- [ ] **Step 5: Update `server.ts` PID path**

In `mcp/linear-agent/src/server.ts`, add the import at the top (after existing imports on lines 1-20):

```typescript
import { homedir } from "node:os";
import { mkdirSync } from "node:fs";
```

Replace line 115:

```typescript
      const pidPath = join(process.cwd(), ".scottclip", ".server.pid");
```

with:

```typescript
      const homeRoot = process.env.SCOTTCLIP_HOME || join(homedir(), ".scottclip");
      mkdirSync(homeRoot, { recursive: true, mode: 0o700 });
      const pidPath = join(homeRoot, `server-${info.port}.pid`);
```

Replace line 132:

```typescript
    const pidPath = join(process.cwd(), ".scottclip", ".server.pid");
```

with:

```typescript
    const homeRoot = process.env.SCOTTCLIP_HOME || join(homedir(), ".scottclip");
    const pidPath = join(homeRoot, `server-${PORT}.pid`);
```

- [ ] **Step 6: Build**

Run: `cd mcp/linear-agent && npm run build`
Expected output: clean compile.

- [ ] **Step 7: Run all tests**

Run: `cd mcp/linear-agent && npx vitest run`
Expected output: all suites green.

- [ ] **Step 8: Commit**

```bash
git add plugins/scottclip/mcp/linear-agent/src/server.ts plugins/scottclip/mcp/linear-agent/src/env.ts plugins/scottclip/mcp/linear-agent/src/__tests__/env.test.ts
git commit -m "feat(server): hoist PID file and .env loading to ~/.scottclip"
```

---

### Task 6: Token hoisting + migration

**Files:**
- Modify: `mcp/linear-agent/src/auth.ts:10-12` (AGENT_DIR derivation)
- Modify: `mcp/linear-agent/src/auth.ts:22-29` (loadCachedToken — add migration)
- Create: `mcp/linear-agent/src/__tests__/auth.test.ts`

Verified live state:
- `auth.ts:10-12` — current AGENT_DIR uses `LINEAR_AGENT_DIR || AGENT_CWD || cwd`
- `auth.ts:225` — `export { AGENT_DIR };` consumers can keep importing this

- [ ] **Step 1: Write failing tests**

Create `mcp/linear-agent/src/__tests__/auth.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let homeDir: string;
let repoDir: string;

beforeEach(() => {
  homeDir = mkdtempSync(join(tmpdir(), "sc-auth-home-"));
  repoDir = mkdtempSync(join(tmpdir(), "sc-auth-repo-"));
  process.env.SCOTTCLIP_HOME = homeDir;
  process.env.AGENT_CWD = repoDir;
  delete process.env.LINEAR_AGENT_DIR;
  vi.resetModules();
});

afterEach(() => {
  delete process.env.SCOTTCLIP_HOME;
  delete process.env.AGENT_CWD;
  rmSync(homeDir, { recursive: true, force: true });
  rmSync(repoDir, { recursive: true, force: true });
});

describe("auth — global token path", () => {
  it("TOKEN_PATH points at ~/.scottclip/token.json", async () => {
    const { TOKEN_PATH } = await import("../auth.js");
    expect(TOKEN_PATH).toBe(join(homeDir, "token.json"));
  });

  it("migrates legacy repo-local token.json to global on first read", async () => {
    mkdirSync(join(repoDir, ".scottclip"), { recursive: true });
    const legacyToken = {
      access_token: "legacy-abc",
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
      refresh_token: "ref-123",
    };
    writeFileSync(
      join(repoDir, ".scottclip", "token.json"),
      JSON.stringify(legacyToken),
    );

    const { getAccessToken, TOKEN_PATH } = await import("../auth.js");
    const access = await getAccessToken();
    expect(access).toBe("legacy-abc");
    expect(existsSync(TOKEN_PATH)).toBe(true);
    const persisted = JSON.parse(readFileSync(TOKEN_PATH, "utf-8"));
    expect(persisted.access_token).toBe("legacy-abc");
  });

  it("uses global token when present, ignoring legacy repo token", async () => {
    writeFileSync(
      join(homeDir, "token.json"),
      JSON.stringify({
        access_token: "global-xyz",
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
      }),
    );
    mkdirSync(join(repoDir, ".scottclip"), { recursive: true });
    writeFileSync(
      join(repoDir, ".scottclip", "token.json"),
      JSON.stringify({
        access_token: "should-not-be-used",
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
      }),
    );
    const { getAccessToken } = await import("../auth.js");
    const access = await getAccessToken();
    expect(access).toBe("global-xyz");
  });
});
```

- [ ] **Step 2: Run tests (expect fail)**

Run: `cd mcp/linear-agent && npx vitest run src/__tests__/auth.test.ts`
Expected output: all three fail — `TOKEN_PATH` is in repoDir, not homeDir; no migration happens.

- [ ] **Step 3: Update `auth.ts`**

Replace lines 1-2 in `mcp/linear-agent/src/auth.ts`:

```typescript
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
```

with:

```typescript
import { readFile, writeFile, mkdir, copyFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
```

Replace lines 10-12:

```typescript
// Fall back to cwd (where the server was started) if AGENT_CWD isn't set yet
const AGENT_DIR = process.env.LINEAR_AGENT_DIR || (process.env.AGENT_CWD ? join(process.env.AGENT_CWD, ".scottclip") : join(process.cwd(), ".scottclip"));
export const TOKEN_PATH = join(AGENT_DIR, "token.json");
```

with:

```typescript
// Token lives in the global scottclip home (~/.scottclip/) so a single
// workspace-scoped OAuth token serves all registered repos.
const AGENT_DIR = process.env.SCOTTCLIP_HOME || join(homedir(), ".scottclip");
export const TOKEN_PATH = join(AGENT_DIR, "token.json");

// Legacy per-repo path used for one-time migration on first read.
function legacyTokenPath(): string | null {
  const legacyRoot = process.env.AGENT_CWD;
  if (!legacyRoot) return null;
  return join(legacyRoot, ".scottclip", "token.json");
}
```

Replace lines 22-29 (`loadCachedToken`):

```typescript
async function loadCachedToken(): Promise<TokenData | null> {
  try {
    const raw = await readFile(TOKEN_PATH, "utf-8");
    return JSON.parse(raw) as TokenData;
  } catch {
    return null;
  }
}
```

with:

```typescript
async function loadCachedToken(): Promise<TokenData | null> {
  try {
    const raw = await readFile(TOKEN_PATH, "utf-8");
    return JSON.parse(raw) as TokenData;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error("Error reading global token:", err);
      return null;
    }
  }
  // Migration: copy legacy per-repo token if global is missing
  const legacy = legacyTokenPath();
  if (!legacy) return null;
  try {
    await stat(legacy);
    await ensureDir();
    await copyFile(legacy, TOKEN_PATH);
    console.log(`Migrated legacy token from ${legacy} to ${TOKEN_PATH}`);
    const raw = await readFile(TOKEN_PATH, "utf-8");
    return JSON.parse(raw) as TokenData;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run auth tests (expect pass)**

Run: `cd mcp/linear-agent && npx vitest run src/__tests__/auth.test.ts`
Expected output: `3 passed`.

- [ ] **Step 5: Run all tests**

Run: `cd mcp/linear-agent && npx vitest run`
Expected output: all suites green.

- [ ] **Step 6: Build**

Run: `cd mcp/linear-agent && npm run build`
Expected output: clean compile.

- [ ] **Step 7: Commit**

```bash
git add plugins/scottclip/mcp/linear-agent/src/auth.ts plugins/scottclip/mcp/linear-agent/src/__tests__/auth.test.ts
git commit -m "feat(auth): hoist token to ~/.scottclip with one-time legacy migration"
```

---

### Task 7: OAuth signed-state callback + organization tool

**Files:**
- Modify: `mcp/linear-agent/src/auth.ts:163-178` (`getAuthUrl`)
- Modify: `mcp/linear-agent/src/oauth.ts` (callback handler)
- Modify: `mcp/linear-agent/src/tools/teams.ts` (add `linear_get_organization` tool)
- Create: `mcp/linear-agent/src/__tests__/oauth.test.ts`

Verified live state:
- `oauth.ts:7-29` — callback handler reads `code` and `error` only; no `state` validation
- `auth.ts:163-178` — `getAuthUrl` builds URL without a `state` param
- `teams.ts:21-25` — `viewer { id name email }`; no `organization` field

- [ ] **Step 1: Write failing tests for state HMAC**

Create `mcp/linear-agent/src/__tests__/oauth.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { signState, verifyState } from "../oauth.js";

const SECRET = "test-client-secret-abc";

describe("oauth state — sign/verify", () => {
  it("verifies a freshly-signed state", () => {
    const state = signState({ cwd: "/repo/a", organizationId: "org-1" }, SECRET);
    const result = verifyState(state, SECRET);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.cwd).toBe("/repo/a");
      expect(result.payload.organizationId).toBe("org-1");
    }
  });

  it("rejects a state signed with a different secret", () => {
    const state = signState({ cwd: "/repo/a", organizationId: "org-1" }, SECRET);
    const result = verifyState(state, "different-secret");
    expect(result.ok).toBe(false);
  });

  it("rejects a tampered payload", () => {
    const state = signState({ cwd: "/repo/a", organizationId: "org-1" }, SECRET);
    const [b64, sig] = state.split(".");
    const tampered = Buffer.from(b64, "base64url").toString("utf-8").replace("/repo/a", "/evil");
    const reencoded = Buffer.from(tampered, "utf-8").toString("base64url");
    const result = verifyState(`${reencoded}.${sig}`, SECRET);
    expect(result.ok).toBe(false);
  });

  it("rejects an expired state", () => {
    const state = signState(
      { cwd: "/repo/a", organizationId: "org-1" },
      SECRET,
      { ttlMs: -1000 }, // already expired
    );
    const result = verifyState(state, SECRET);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("expired");
  });

  it("includes a unique nonce for each call", () => {
    const a = signState({ cwd: "/repo/a", organizationId: "org-1" }, SECRET);
    const b = signState({ cwd: "/repo/a", organizationId: "org-1" }, SECRET);
    expect(a).not.toBe(b);
  });
});
```

- [ ] **Step 2: Run tests (expect fail — functions missing)**

Run: `cd mcp/linear-agent && npx vitest run src/__tests__/oauth.test.ts`
Expected output: `signState`/`verifyState` not exported.

- [ ] **Step 3: Add signed-state helpers to `oauth.ts`**

In `mcp/linear-agent/src/oauth.ts`, replace the entire current file content with:

```typescript
import { Hono } from "hono";
import { createHmac, randomBytes } from "node:crypto";
import { exchangeAuthCode, getAuthUrl, getCallbackUrl } from "./auth.js";
import { list as listTeams } from "./registry.js";

interface StatePayload {
  cwd: string;
  organizationId: string;
  nonce: string;
  exp: number;
}

export function signState(
  input: { cwd: string; organizationId: string },
  secret: string,
  opts: { ttlMs?: number } = {},
): string {
  const ttl = opts.ttlMs ?? 10 * 60 * 1000;
  const payload: StatePayload = {
    cwd: input.cwd,
    organizationId: input.organizationId,
    nonce: randomBytes(8).toString("hex"),
    exp: Date.now() + ttl,
  };
  const body = Buffer.from(JSON.stringify(payload), "utf-8").toString("base64url");
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export type StateVerifyResult =
  | { ok: true; payload: StatePayload }
  | { ok: false; reason: "malformed" | "bad-signature" | "expired" };

export function verifyState(state: string, secret: string): StateVerifyResult {
  const dot = state.indexOf(".");
  if (dot < 0) return { ok: false, reason: "malformed" };
  const body = state.slice(0, dot);
  const sig = state.slice(dot + 1);
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  if (sig.length !== expected.length) return { ok: false, reason: "bad-signature" };
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return { ok: false, reason: "bad-signature" };
  let payload: StatePayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf-8")) as StatePayload;
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (typeof payload.exp !== "number" || Date.now() > payload.exp) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, payload };
}

const ORG_QUERY = `query Organization { organization { id name urlKey } }`;

async function fetchOrganizationId(): Promise<string> {
  const { gql } = await import("./graphql.js");
  const data = await gql<{ organization: { id: string } }>(ORG_QUERY);
  return data.organization.id;
}

export function createOAuthRoute(): Hono {
  const app = new Hono();

  app.get("/callback", async (c) => {
    const error = c.req.query("error");
    if (error) {
      console.error(`OAuth error: ${error}`);
      return c.html(`<h1>Authorization failed</h1><p>${error}</p>`, 400);
    }

    const code = c.req.query("code");
    if (!code) {
      return c.html(`<h1>Missing authorization code</h1>`, 400);
    }

    const state = c.req.query("state");
    const secret = process.env.LINEAR_CLIENT_SECRET;
    if (!secret) {
      return c.html(`<h1>Server misconfigured</h1><p>LINEAR_CLIENT_SECRET not set.</p>`, 500);
    }

    let statePayload: StatePayload | null = null;
    if (state) {
      const verified = verifyState(state, secret);
      if (!verified.ok) {
        console.error(`OAuth state verification failed: ${verified.reason}`);
        return c.html(`<h1>State verification failed</h1><p>${verified.reason}</p>`, 400);
      }
      statePayload = verified.payload;
    }

    try {
      const redirectUri = getCallbackUrl();
      await exchangeAuthCode(code, redirectUri);
      console.log("OAuth authorization successful — token saved to ~/.scottclip/token.json");

      // Verify single-workspace invariant + write registry entry
      if (statePayload) {
        const orgIdFromLinear = await fetchOrganizationId();
        const existing = listTeams();
        const conflict = existing.find((e) => e.organizationId !== orgIdFromLinear);
        if (conflict) {
          return c.html(
            `<h1>Workspace mismatch</h1><p>This server already serves workspace <code>${conflict.organizationId}</code> — refusing to add ${orgIdFromLinear}.</p>`,
            409,
          );
        }
        // Stash the verified org id back onto the per-team registry update during /sc-init
        // (the actual register() call happens in the skill once teamId is chosen). We do
        // not write a registry entry here because OAuth state may bind multiple teams in
        // sequence; /sc-init is responsible for the per-team register().
        console.log(`OAuth bound to organizationId=${orgIdFromLinear} (cwd ${statePayload.cwd})`);
      }

      return c.html(`<h1>Authorized!</h1><p>Token saved. You can close this tab and return to Claude Code.</p>`);
    } catch (err) {
      console.error("OAuth token exchange failed:", err);
      const message = err instanceof Error ? err.message : String(err);
      return c.html(`<h1>Token exchange failed</h1><p>${message}</p>`, 500);
    }
  });

  return app;
}

export function createStatusRoute(): Hono {
  const app = new Hono();
  app.get("/", (c) => {
    let authLink = "";
    try {
      const authUrl = getAuthUrl();
      authLink = `<p><a href="${authUrl}">Authorize with Linear</a></p>`;
    } catch {
      authLink = `<p>OAuth unavailable (LINEAR_CLIENT_ID not set)</p>`;
    }
    return c.html(
      `<h1>ScottClip Linear Agent</h1>` +
        `<p>MCP server running on port ${process.env.WEBHOOK_PORT || "3847"}</p>` +
        `<p>Routes: /mcp, /webhook, /oauth/callback</p>` +
        authLink,
    );
  });
  return app;
}
```

- [ ] **Step 4: Update `auth.ts:163-178` (`getAuthUrl`) to accept and append a state param**

Replace `getAuthUrl` in `mcp/linear-agent/src/auth.ts`:

```typescript
export function getAuthUrl(state?: string): string {
  const clientId = process.env.LINEAR_CLIENT_ID;
  if (!clientId) {
    throw new Error("LINEAR_CLIENT_ID must be set.");
  }
  const callbackHost = process.env.LINEAR_CALLBACK_HOST || `http://localhost:${process.env.WEBHOOK_PORT || "3847"}`;
  const redirectUri = `${callbackHost}/oauth/callback`;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "read,write,app:assignable,app:mentionable",
    actor: "app",
  });
  if (state) params.set("state", state);
  return `https://linear.app/oauth/authorize?${params}`;
}
```

- [ ] **Step 5: Add the `linear_get_organization` MCP tool**

In `mcp/linear-agent/src/tools/teams.ts`, after the `LIST_USERS_QUERY` constant (current line 19), add:

```typescript
const ORGANIZATION_QUERY = `
  query Organization {
    organization { id name urlKey }
  }
`;
```

Inside `registerTeamTools`, after the `linear_get_viewer` registration (current lines 58-72), add a new tool:

```typescript
  server.registerTool(
    "linear_get_organization",
    {
      description: "Return the current Linear workspace (organization). Used by /sc-init to enforce single-workspace per server.",
      inputSchema: {},
    },
    async () => {
      const data = await gql<{ organization: { id: string; name: string; urlKey: string } }>(ORGANIZATION_QUERY);
      return { content: [{ type: "text" as const, text: JSON.stringify(data.organization, null, 2) }] };
    },
  );
```

- [ ] **Step 6: Run oauth tests (expect pass)**

Run: `cd mcp/linear-agent && npx vitest run src/__tests__/oauth.test.ts`
Expected output: `5 passed`.

- [ ] **Step 7: Run all tests**

Run: `cd mcp/linear-agent && npx vitest run`
Expected output: all suites green.

- [ ] **Step 8: Build**

Run: `cd mcp/linear-agent && npm run build`
Expected output: clean compile.

- [ ] **Step 9: Commit**

```bash
git add plugins/scottclip/mcp/linear-agent/src/oauth.ts plugins/scottclip/mcp/linear-agent/src/auth.ts plugins/scottclip/mcp/linear-agent/src/tools/teams.ts plugins/scottclip/mcp/linear-agent/src/__tests__/oauth.test.ts
git commit -m "feat(oauth): sign callback state with HMAC and add linear_get_organization tool"
```

---

### Task 8: Update `/sc-init` skill for multi-repo mode

**Files:**
- Modify: `skills/init/SKILL.md`

Verified live state (`skills/init/SKILL.md` 415 lines):
- Lines 1-5 — frontmatter with `version: 0.4.0`
- Lines 22-46 — current "State Detection" handles only the per-repo case
- Lines 49-198 — Phase 1 collects credentials, writes per-repo `.scottclip/.env`, starts server, browser auth
- Lines 200-390 — Phase 2 picks team, scaffolds roles
- Line 100 — current `.scottclip/.env` template includes `AGENT_CWD=<current_working_directory>` which becomes obsolete

This task has no automated tests — it edits a skill that humans run interactively. Verification is a manual smoke test on a clean repo.

- [ ] **Step 1: Bump skill version**

In `skills/init/SKILL.md` lines 1-5, change `version: 0.4.0` to `version: 0.5.0`.

- [ ] **Step 2: Insert Phase 0 ("Mode detection") after the State Detection section**

Insert after line 46 (after the existing State Detection list, before the `---` separator on line 47):

```markdown
## Phase 0: Detect Multi-Repo Mode

Before Phase 1, detect whether a global ScottClip server is already running for another repo:

1. Check if `~/.scottclip/registry.json` exists:
   ```
   Run via Bash: cat ~/.scottclip/registry.json 2>/dev/null
   ```
   - **File exists with at least one team entry** → multi-repo mode. The user has already initialized at least one other repo. Skip Phase 1's credential collection (credentials live in `~/.scottclip/.env`) and skip the server-start step (a server is already running for the workspace). Jump to Phase 1.5.
   - **File missing or empty** → fresh install. Continue with Phase 1.

2. Multi-repo mode also requires verifying we're targeting the same workspace. If the registry has entries, retrieve the existing `organizationId` (from any entry) and remember it for Step 0 of Phase 2.
```

- [ ] **Step 3: Replace Phase 1 Step 2's `.scottclip/.env` block (lines 93-101) with global-aware variant**

Replace:

```
**Write `.scottclip/.env`.** Create the `.scottclip/` directory if needed. Write credentials to `.scottclip/.env` (the server loads this file automatically):

\```
LINEAR_CLIENT_ID=<client_id>
LINEAR_CLIENT_SECRET=<client_secret>
LINEAR_WEBHOOK_SECRET=
LINEAR_CALLBACK_HOST=<tunnel_hostname>
AGENT_CWD=<current_working_directory>
\```
```

with:

```
**Write `~/.scottclip/.env`.** Create `~/.scottclip/` (mode 0700) if needed. Write credentials to the global env file (the server loads this file automatically and it covers all repos):

\```
LINEAR_CLIENT_ID=<client_id>
LINEAR_CLIENT_SECRET=<client_secret>
LINEAR_WEBHOOK_SECRET=
LINEAR_CALLBACK_HOST=<tunnel_hostname>
\```

`AGENT_CWD` is no longer required — the server resolves the target repo at runtime via `~/.scottclip/registry.json`.
```

- [ ] **Step 4: Insert Phase 1.5 ("Lift secrets") after Phase 1 Step 4**

Insert after line 198 (after the "Stop here. Phase 2 runs after restart." line):

```markdown
---

## Phase 1.5: Migrate Per-Repo Secrets (only when re-running on existing repos)

If the repo already has a legacy `.scottclip/.env` from an older ScottClip version, copy any keys not already in the global env over and then delete the legacy file:

```
Run via Bash:
  if [ -f .scottclip/.env ] && [ -f ~/.scottclip/.env ]; then
    while IFS='=' read -r k v; do
      [ -z "$k" ] && continue
      [[ "$k" =~ ^# ]] && continue
      grep -q "^$k=" ~/.scottclip/.env || echo "$k=$v" >> ~/.scottclip/.env
    done < .scottclip/.env
    mv .scottclip/.env .scottclip/.env.legacy
  fi
```

Likewise, if a legacy `.scottclip/token.json` exists in this repo and `~/.scottclip/token.json` does not, the auth module will migrate it on its next read. No manual step required — but report to the user:

```
✓ Found legacy token at .scottclip/token.json — will be migrated to ~/.scottclip/token.json on next request
```
```

- [ ] **Step 5: Add Step 0 to Phase 2 ("Register this repo in the global registry")**

Insert directly after the `## Phase 2: Set Up ScottClip` heading (currently line 202), before `### Step 1: Verify Authorization`:

```markdown
### Step 0: Register this repo in the global registry

After Phase 2 Step 2 picks the team (skip ahead, do that step first, then return here — or perform Step 0 inline after team selection):

1. Call `linear_get_organization` to retrieve the workspace `id`.
2. If `~/.scottclip/registry.json` already has any entries, verify their `organizationId` matches the one returned. If not, abort with:
   ```
   This server is already serving workspace <existing-orgId>.
   This repo's workspace is <new-orgId>. A single ScottClip server can serve only one workspace.
   Stop a different server or use SCOTTCLIP_HOME=/some/other/path to run a second server in parallel.
   ```
3. Write a registry entry:
   ```
   Run via Bash:
     node -e '
       const r = require("<resolved_plugin_root>/mcp/linear-agent/dist/registry.js");
       r.register({
         teamId: "<selected_team_id>",
         cwd: process.cwd(),
         configPath: require("path").join(process.cwd(), ".scottclip", "config.yaml"),
         organizationId: "<organization_id>",
       });
     '
   ```
4. Report:
   ```
   ✓ Registered team <team_id> → <cwd> in ~/.scottclip/registry.json
   ```
```

(Note: if Phase 2 ordering makes inline insertion awkward, the skill can also be reorganized so that team selection happens before role scaffolding and the registry write happens immediately after — but the simplest path is the cross-reference above.)

- [ ] **Step 6: Update Phase 1 Step 3 (server start) to skip when registry-mode is active**

In Phase 1 Step 3 (currently lines 110-148), add at the top:

```markdown
**Skip this entire step if Phase 0 detected an existing server for the same workspace.** Run `lsof -i :3847` to confirm the global server is already running before continuing.
```

- [ ] **Step 7: Update Phase 1 Step 3 #6 (auth URL) to include signed state**

In Phase 1 Step 3, item #6 (currently lines 166-169), add a note:

```markdown
> The authorization URL should include a `state` parameter signed by the server. The skill cannot generate this signature — instead, fetch the URL from the server's status page:
> ```
> Run via Bash: curl -s http://localhost:3847/ | grep -oE 'href="[^"]*authorize[^"]*"'
> ```
> Open the resulting URL. The server signs `state` server-side using `LINEAR_CLIENT_SECRET`, encoding `{ cwd, organizationId, nonce, exp }`.
```

- [ ] **Step 8: Manual smoke test**

Document the smoke test inline at the bottom of the skill (after the existing `## Re-initialization` section). Append:

```markdown
---

## Manual Smoke Test (multi-repo)

After implementing multi-repo mode, verify end-to-end:

1. In repo A, run `/scottclip-init` and complete Phase 1 + Phase 2. Confirm `~/.scottclip/registry.json` has team A.
2. In repo B (different team in the same Linear workspace), run `/scottclip-init`. Confirm Phase 0 detects the existing server, Phase 1 is skipped, registry now has team A and team B.
3. In Linear, mention the agent on an issue in team A — confirm Claude spawns in repo A's cwd (check `pwd` from a Bash tool call).
4. In Linear, mention the agent on an issue in team B — confirm Claude spawns in repo B's cwd.
5. Stop a session in team A — confirm only that session is killed; team B is unaffected.
6. Try to register a third repo in a *different* Linear workspace — expect Phase 2 Step 0 to abort with the workspace-mismatch error.
```

- [ ] **Step 9: Commit**

```bash
git add plugins/scottclip/skills/init/SKILL.md
git commit -m "docs(init): teach /sc-init about ~/.scottclip global home and registry"
```

---

### Task 9: Cleanup, env example, and version bump

**Files:**
- Modify: `mcp/linear-agent/src/webhook.ts` (remove `getConfiguredTeamId`, `readConfigRaw`)
- Modify: `mcp/linear-agent/.env.example`
- Modify: `mcp/linear-agent/package.json`
- Modify: `plugins/scottclip/CLAUDE.md`

Verified live state:
- `webhook.ts:8-22` — `readConfigRaw()` and `getConfiguredTeamId()` are no longer referenced after Task 4 (the registry path supersedes them, the per-repo `getAutoReactConfig` reads the config via `ctx.configPath` directly)
- `package.json:3` — `"version": "1.5.0"`
- `.env.example` — currently mentions `LINEAR_AGENT_DIR` and `AGENT_CWD`

- [ ] **Step 1: Remove dead helpers from `webhook.ts`**

In `mcp/linear-agent/src/webhook.ts`, delete lines 8-22 (the `readConfigRaw()` and `getConfiguredTeamId()` definitions). Verify by running:

Run: `cd mcp/linear-agent && grep -n "getConfiguredTeamId\|readConfigRaw" src/webhook.ts`
Expected output: no matches.

Run: `cd mcp/linear-agent && grep -rn "getConfiguredTeamId\|readConfigRaw" src/`
Expected output: no matches.

Update `getAutoReactConfig` (currently lines 29-41) to require an explicit `raw` argument (its only caller post-Task-4 already passes the raw content read from `ctx.configPath`):

```typescript
export function getAutoReactConfig(raw: string | undefined): AutoReactConfig {
  const defaults: AutoReactConfig = { autoReact: false, quietWindowS: 30 };
  if (!raw) return defaults;
  const autoReactMatch = raw.match(/^\s*auto_react:\s*(true|false)/m);
  const quietWindowMatch = raw.match(/^\s*quiet_window_s:\s*(\d+)/m);
  return {
    autoReact: autoReactMatch ? autoReactMatch[1] === "true" : defaults.autoReact,
    quietWindowS: quietWindowMatch ? parseInt(quietWindowMatch[1], 10) : defaults.quietWindowS,
  };
}
```

Update the existing `webhook.test.ts` calls — the three existing `getAutoReactConfig(undefined)` paths must pass an argument explicitly. The line `getAutoReactConfig("version: 2\n...")` already does so. The "returns defaults" test that calls `getAutoReactConfig(undefined)` is fine. The only change needed is to ensure no caller relies on the default arity.

- [ ] **Step 2: Remove unused imports**

In `mcp/linear-agent/src/webhook.ts`, the imports of `readFileSync` (line 4) and `join` from `node:path` (line 5) may now have a single remaining caller via `legacyContext` (Task 3). After Task 4, `legacyContext` is gone — verify whether `readFileSync` and `join` are still used. If `join` is still used by the stop-signal `sessionsDir` path, keep it; remove `readFileSync` if no longer referenced. Run:

Run: `cd mcp/linear-agent && grep -n "readFileSync\|^import" src/webhook.ts`
Inspect output. If `readFileSyncForCtx` (the alias added in Task 4) is the only consumer of `readFileSync`, the import is needed; otherwise remove it.

- [ ] **Step 3: Remove `LINEAR_AGENT_DIR` and `AGENT_CWD` from `.env.example`**

Replace `mcp/linear-agent/.env.example` content with:

```
# Linear OAuth app credentials (single workspace per server)
LINEAR_CLIENT_ID=your_client_id
LINEAR_CLIENT_SECRET=your_client_secret

# Webhook secret for HMAC signature validation
LINEAR_WEBHOOK_SECRET=your_webhook_secret

# Public callback host for OAuth (tunnel URL)
LINEAR_CALLBACK_HOST=https://your-tunnel.example.com

# Optional — override scottclip home (default: ~/.scottclip)
# SCOTTCLIP_HOME=/custom/path

# Optional — override webhook port (default: 3847)
# WEBHOOK_PORT=3847
```

- [ ] **Step 4: Verify `LINEAR_AGENT_DIR` and `AGENT_CWD` are not consumed by code anymore**

Run: `cd mcp/linear-agent && grep -rn "LINEAR_AGENT_DIR" src/`
Expected output: no matches (the only reference was in `auth.ts:11`, replaced in Task 6).

Run: `cd mcp/linear-agent && grep -rn "AGENT_CWD" src/`
Expected output: only the legacy fallback in `webhook.ts` (`buildRepoContext` registry-empty branch). Confirm that's the ONLY remaining match.

- [ ] **Step 5: Bump package version**

In `mcp/linear-agent/package.json:3`, change `"version": "1.5.0"` to `"version": "1.7.0"`.

- [ ] **Step 6: Update `plugins/scottclip/CLAUDE.md`**

Read `/Users/scottzilla/code/claude-hub/worktrees/scottclip-multi-repo/plugins/scottclip/CLAUDE.md` and locate the "Two-level structure" or equivalent architecture section. Append a third bullet at the appropriate location:

```markdown
3. **Global home** (`~/.scottclip/`) — shared across all repos in the same Linear workspace. Contains `registry.json` (teamId → repo mapping), `.env` (OAuth credentials), `token.json` (workspace-scoped access token), and `server-<port>.pid`. Created by the first `/scottclip-init`; later inits append to the registry without touching credentials.
```

If a different section makes more sense (e.g., a new "## Global Home" subsection), use that — the goal is the next reader knows about `~/.scottclip/`.

- [ ] **Step 7: Run all tests**

Run: `cd mcp/linear-agent && npx vitest run`
Expected output: all suites green.

- [ ] **Step 8: Build**

Run: `cd mcp/linear-agent && npm run build`
Expected output: clean compile.

- [ ] **Step 9: Manual end-to-end smoke**

(Manual — not a test command.) Start the server with `SCOTTCLIP_HOME=/tmp/sc-test npm run start`, register two fake teams via a quick `node -e` snippet, hit `/webhook` with a signed AgentSessionEvent for each team, confirm the server logs route to the right cwd. Tear down `/tmp/sc-test`.

- [ ] **Step 10: Commit**

```bash
git add plugins/scottclip/mcp/linear-agent/src/webhook.ts plugins/scottclip/mcp/linear-agent/.env.example plugins/scottclip/mcp/linear-agent/package.json plugins/scottclip/CLAUDE.md plugins/scottclip/mcp/linear-agent/src/__tests__/webhook.test.ts
git commit -m "chore(scottclip): drop AGENT_CWD/LINEAR_AGENT_DIR, bump to v1.7.0"
```

---

## Final Self-Review Checklist

Before merging the branch, the implementing agent must walk through these checks:

- [ ] All nine tasks committed in order with Conventional Commit messages
- [ ] `npx vitest run` from `mcp/linear-agent/` shows zero failures across all suites
- [ ] `npm run build` produces a clean `dist/` (only the pre-existing SDK import warning, no new errors)
- [ ] `grep -rn "AGENT_CWD" plugins/scottclip/mcp/linear-agent/src/` returns at most one match (the `buildRepoContext` legacy fallback)
- [ ] `grep -rn "LINEAR_AGENT_DIR" plugins/scottclip/mcp/linear-agent/src/` returns zero matches
- [ ] `grep -rn "getConfiguredTeamId\|readConfigRaw" plugins/scottclip/mcp/linear-agent/src/` returns zero matches
- [ ] `~/.scottclip/registry.json` is created with mode 0600 by Task 1's tests
- [ ] OAuth callback rejects missing/expired/tampered state in Task 7's tests
- [ ] Webhook returns 200 silently for unknown teamId when registry is populated (Task 4)
- [ ] Webhook falls back to `AGENT_CWD` when registry is empty (Task 4)
- [ ] Per-team debouncers are isolated (Task 4 final test)
- [ ] Q2 (stop-signal teamId) was empirically resolved with logs and the chosen branch is documented in the Task 4 commit body
- [ ] `skills/init/SKILL.md` Phase 0 short-circuits when registry exists; Phase 2 Step 0 enforces single-workspace
- [ ] `package.json` is at `1.7.0`
- [ ] CLAUDE.md mentions `~/.scottclip/`

Run a final smoke test by initializing a real second repo against the same workspace, mention the agent on an issue in each team, and watch both spawn correctly.
