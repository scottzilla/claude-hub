# Consolidated MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate the MCP server and webhook receiver into a single Hono-based HTTP server

**Architecture:** Single Hono app on port 3847 with WebStandardStreamableHTTPServerTransport for MCP tools, webhook handler for Linear events, OAuth callback, and built-in polling timer. Server spawns fresh Claude sessions per issue.

**Tech Stack:** Hono, @hono/node-server, @modelcontextprotocol/sdk (WebStandardStreamableHTTPServerTransport), vitest, Node.js 18+, TypeScript

**Design spec:** `docs/superpowers/specs/2026-04-06-consolidated-mcp-server-design.md`

**Package location:** `mcp/linear-agent/` (relative to plugin root)

---

## Task 1: Add dependencies and update project configuration

**Files:**
- Modify: `mcp/linear-agent/package.json`
- Modify: `mcp/linear-agent/tsconfig.json`

### Steps

- [ ] **1.1** Install new dependencies:
  ```bash
  cd mcp/linear-agent && npm install hono @hono/node-server && npm install -D vitest
  ```

- [ ] **1.2** Update `package.json` scripts. Replace the existing scripts block:
  ```json
  {
    "scripts": {
      "build": "tsc",
      "dev": "tsx src/server.ts",
      "prepare": "npm run build",
      "start": "node dist/src/server.js",
      "stop": "lsof -i :${WEBHOOK_PORT:-3847} -t | xargs kill 2>/dev/null || true",
      "start:tunnel": "npm run start & cloudflared tunnel --url http://localhost:${WEBHOOK_PORT:-3847}",
      "test": "vitest run",
      "test:watch": "vitest"
    }
  }
  ```
  Remove the old `webhook`, `webhook:stop`, `webhook:restart`, `webhook:tunnel` scripts entirely.

- [ ] **1.3** Update `tsconfig.json` — remove `"webhook"` from the `include` array. The new include should be:
  ```json
  {
    "include": ["src"]
  }
  ```

- [ ] **1.4** Add vitest config. Create `mcp/linear-agent/vitest.config.ts`:
  ```typescript
  import { defineConfig } from "vitest/config";

  export default defineConfig({
    test: {
      include: ["src/__tests__/**/*.test.ts"],
    },
  });
  ```

- [ ] **1.5** Verify:
  ```bash
  cd mcp/linear-agent && npx tsc --noEmit
  ```
  Expected: exits 0 with no errors.

- [ ] **1.6** Commit:
  ```
  chore(linear-agent): add hono, @hono/node-server, vitest; update scripts and tsconfig
  ```

---

## Task 2: Extract spawn.ts from webhook/receiver.ts

**Files:**
- Create: `mcp/linear-agent/src/spawn.ts`
- Create: `mcp/linear-agent/src/__tests__/spawn.test.ts`

### Steps

- [ ] **2.1** Write the test first. Create `src/__tests__/spawn.test.ts`:
  ```typescript
  import { describe, it, expect, vi, beforeEach } from "vitest";
  import { buildClaudeArgs } from "../spawn.js";

  describe("buildClaudeArgs", () => {
    it("builds correct CLI args for a created session event", () => {
      const event = {
        type: "AgentSessionEvent",
        action: "created",
        data: {
          id: "session-123",
          issueIdentifier: "SC-42",
          agentActivity: {
            body: "Fix the login bug",
          },
          promptContext: "The login page throws a 500 error",
        },
      };

      const result = buildClaudeArgs(event);

      expect(result.prompt).toContain("Linear agent event: AgentSessionEvent (created)");
      expect(result.prompt).toContain("Session: session-123");
      expect(result.prompt).toContain("Issue: SC-42");
      expect(result.prompt).toContain("User message: Fix the login bug");
      expect(result.prompt).toContain("Context:");
      expect(result.prompt).toContain("The login page throws a 500 error");
      expect(result.prompt).toContain("/heartbeat --issue SC-42");
      expect(result.cliArgs).toContain("-p");
      expect(result.cliArgs).toContain("--allowedTools");
    });

    it("handles missing optional fields gracefully", () => {
      const event = {
        type: "AgentSessionEvent",
        action: "created",
        data: {
          id: "session-456",
        },
      };

      const result = buildClaudeArgs(event);

      expect(result.prompt).toContain("Issue: unknown");
      expect(result.prompt).not.toContain("User message:");
      expect(result.prompt).not.toContain("Context:");
    });

    it("uses issueId as fallback when issueIdentifier is absent", () => {
      const event = {
        type: "AgentSessionEvent",
        action: "prompted",
        data: {
          id: "session-789",
          issueId: "abc-def",
        },
      };

      const result = buildClaudeArgs(event);

      expect(result.prompt).toContain("Issue: abc-def");
    });
  });
  ```

- [ ] **2.2** Run the test — verify it fails:
  ```bash
  cd mcp/linear-agent && npx vitest run src/__tests__/spawn.test.ts
  ```
  Expected: fails because `src/spawn.ts` does not exist.

- [ ] **2.3** Create `src/spawn.ts`:
  ```typescript
  import { spawn } from "node:child_process";
  import { gql } from "./graphql.js";

  const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";
  const TARGET_REPO = process.env.AGENT_CWD;

  const ACK_MUTATION = `
    mutation AckSession($input: AgentActivityCreateInput!) {
      agentActivityCreate(input: $input) {
        success
      }
    }
  `;

  export interface ClaudeArgs {
    prompt: string;
    cliArgs: string[];
  }

  export function buildClaudeArgs(event: Record<string, unknown>): ClaudeArgs {
    const data = event.data as Record<string, unknown> | undefined;
    const issueIdentifier = (data?.issueIdentifier || data?.issueId || "unknown") as string;
    const sessionId = (data?.id || "unknown") as string;
    const eventType = (event.type as string) || "unknown";
    const action = (event.action as string) || "unknown";

    const activity = data?.agentActivity as Record<string, unknown> | undefined;
    const promptBody = activity?.body as string | undefined;
    const promptContext = data?.promptContext as string | undefined;

    const lines = [
      `Linear agent event: ${eventType} (${action})`,
      `Session: ${sessionId}`,
      `Issue: ${issueIdentifier}`,
    ];

    if (promptBody) {
      lines.push("", `User message: ${promptBody}`);
    }
    if (promptContext) {
      lines.push("", "Context:", promptContext);
    }

    lines.push(
      "",
      `Run /heartbeat --issue ${issueIdentifier} to process this issue. The agent session is already acknowledged.`
    );

    const prompt = lines.join("\n");

    const cliArgs = [
      "-p",
      prompt,
      "--allowedTools",
      "mcp__linear_agent*,Read,Write,Edit,Bash,Grep,Glob,Agent",
    ];

    return { prompt, cliArgs };
  }

  export async function ackSession(sessionId: string, message = "Starting up..."): Promise<void> {
    try {
      await gql(ACK_MUTATION, {
        input: {
          sessionId,
          type: "thought",
          body: message,
          ephemeral: true,
        },
      });
      console.log(`Acked session ${sessionId}`);
    } catch (err) {
      console.error(`Failed to ack session ${sessionId}:`, err);
    }
  }

  export async function spawnClaudeSession(event: Record<string, unknown>): Promise<void> {
    if (!TARGET_REPO) {
      console.error("AGENT_CWD not set — cannot spawn Claude session");
      return;
    }

    const data = event.data as Record<string, unknown> | undefined;
    const issueIdentifier = (data?.issueIdentifier || data?.issueId || "unknown") as string;
    const sessionId = (data?.id || "unknown") as string;

    const { cliArgs } = buildClaudeArgs(event);

    console.log(`Spawning Claude for ${issueIdentifier} (session ${sessionId})`);

    const child = spawn(CLAUDE_BIN, cliArgs, {
      cwd: TARGET_REPO,
      stdio: "ignore",
      detached: true,
      env: { ...process.env },
    });

    child.unref();

    child.on("error", (err) => {
      console.error(`Failed to spawn Claude for ${issueIdentifier}:`, err);
    });
  }
  ```

- [ ] **2.4** Run the test — verify it passes:
  ```bash
  cd mcp/linear-agent && npx vitest run src/__tests__/spawn.test.ts
  ```
  Expected: 3 tests pass.

- [ ] **2.5** Verify full build:
  ```bash
  cd mcp/linear-agent && npx tsc --noEmit
  ```

- [ ] **2.6** Commit:
  ```
  feat(linear-agent): extract spawn.ts with spawnClaudeSession, ackSession, buildClaudeArgs
  ```

---

## Task 3: Extract webhook.ts from webhook/receiver.ts

**Files:**
- Create: `mcp/linear-agent/src/webhook.ts`
- Create: `mcp/linear-agent/src/__tests__/webhook.test.ts`

### Steps

- [ ] **3.1** Write the test first. Create `src/__tests__/webhook.test.ts`:
  ```typescript
  import { describe, it, expect, vi, beforeEach } from "vitest";
  import { verifySignature } from "../webhook.js";
  import { createHmac } from "node:crypto";

  describe("verifySignature", () => {
    const secret = "test-webhook-secret-12345";

    it("returns true for a valid HMAC-SHA256 signature", () => {
      const body = '{"type":"AgentSessionEvent","action":"created"}';
      const signature = createHmac("sha256", secret).update(body).digest("hex");

      expect(verifySignature(body, signature, secret)).toBe(true);
    });

    it("returns false for an invalid signature", () => {
      const body = '{"type":"AgentSessionEvent","action":"created"}';
      const signature = "0000000000000000000000000000000000000000000000000000000000000000";

      expect(verifySignature(body, signature, secret)).toBe(false);
    });

    it("returns false when signature is null", () => {
      const body = '{"some":"data"}';

      expect(verifySignature(body, null, secret)).toBe(false);
    });

    it("returns false when secret is undefined", () => {
      const body = '{"some":"data"}';
      const signature = "anything";

      expect(verifySignature(body, signature, undefined)).toBe(false);
    });
  });
  ```

- [ ] **3.2** Run the test — verify it fails:
  ```bash
  cd mcp/linear-agent && npx vitest run src/__tests__/webhook.test.ts
  ```
  Expected: fails because `src/webhook.ts` does not exist.

- [ ] **3.3** Create `src/webhook.ts`:
  ```typescript
  import { Hono } from "hono";
  import { createHmac, randomUUID } from "node:crypto";
  import { writeFile, mkdir } from "node:fs/promises";
  import { join } from "node:path";
  import { AGENT_DIR } from "./auth.js";
  import { ackSession, spawnClaudeSession } from "./spawn.js";

  const EVENTS_DIR = join(AGENT_DIR, "events");

  export function verifySignature(
    body: string,
    signature: string | null,
    secret: string | undefined
  ): boolean {
    if (!secret) return false;
    if (!signature) return false;
    const expected = createHmac("sha256", secret).update(body).digest("hex");
    const match = signature === expected;
    if (!match) {
      console.error(
        `Signature mismatch — expected: ${expected.substring(0, 16)}..., got: ${signature.substring(0, 16)}...`
      );
    }
    return match;
  }

  async function ensureEventsDir(): Promise<void> {
    await mkdir(EVENTS_DIR, { recursive: true });
  }

  export function createWebhookRoute(): Hono {
    const app = new Hono();

    app.post("/", async (c) => {
      const secret = process.env.LINEAR_WEBHOOK_SECRET;
      const body = await c.req.text();
      const signature = c.req.header("linear-signature") ?? null;

      if (!verifySignature(body, signature, secret)) {
        console.error("Invalid webhook signature");
        return c.text("Invalid signature", 401);
      }

      try {
        const event = JSON.parse(body);
        const enriched = {
          ...event,
          receivedAt: new Date().toISOString(),
        };

        await ensureEventsDir();
        const filename = `${Date.now()}-${randomUUID()}.json`;
        await writeFile(join(EVENTS_DIR, filename), JSON.stringify(enriched, null, 2));

        console.log(
          `Event received: ${event.type || "unknown"} (${event.action || "?"}) -> ${filename}`
        );

        // Respond 200 immediately, then handle async work
        const response = c.text("OK", 200);

        if (event.type === "AgentSessionEvent" && event.data?.id) {
          const sessionId = event.data.id as string;

          if (event.action === "created") {
            ackSession(sessionId, "Starting up...").catch((err) =>
              console.error("Ack error:", err)
            );
            spawnClaudeSession(event).catch((err) => console.error("Spawn error:", err));
          } else if (event.action === "prompted") {
            ackSession(sessionId, "Reading your message...").catch((err) =>
              console.error("Ack error:", err)
            );
            spawnClaudeSession(event).catch((err) => console.error("Spawn error:", err));
          }
        }

        return response;
      } catch (err) {
        console.error("Failed to process webhook:", err);
        return c.text("Internal error", 500);
      }
    });

    return app;
  }
  ```

- [ ] **3.4** Run the test — verify it passes:
  ```bash
  cd mcp/linear-agent && npx vitest run src/__tests__/webhook.test.ts
  ```
  Expected: 4 tests pass.

- [ ] **3.5** Verify build:
  ```bash
  cd mcp/linear-agent && npx tsc --noEmit
  ```

- [ ] **3.6** Commit:
  ```
  feat(linear-agent): extract webhook.ts with HMAC verification and event handling
  ```

---

## Task 4: Extract oauth.ts from webhook/receiver.ts

**Files:**
- Create: `mcp/linear-agent/src/oauth.ts`

### Steps

- [ ] **4.1** Create `src/oauth.ts`:
  ```typescript
  import { Hono } from "hono";
  import { exchangeAuthCode, getAuthUrl, getCallbackUrl } from "./auth.js";

  export function createOAuthRoute(): Hono {
    const app = new Hono();

    app.get("/callback", async (c) => {
      const error = c.req.query("error");
      if (error) {
        console.error(`OAuth error: ${error}`);
        return c.html(`<h1>Authorization failed</h1><p>${error}</p><p>Close this tab and try again.</p>`, 400);
      }

      const code = c.req.query("code");
      if (!code) {
        return c.html(`<h1>Missing authorization code</h1><p>Close this tab and try again.</p>`, 400);
      }

      try {
        const redirectUri = getCallbackUrl();
        await exchangeAuthCode(code, redirectUri);
        console.log("OAuth authorization successful — token saved");
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
        authLink
      );
    });

    return app;
  }
  ```

- [ ] **4.2** Verify build:
  ```bash
  cd mcp/linear-agent && npx tsc --noEmit
  ```

- [ ] **4.3** Commit:
  ```
  feat(linear-agent): extract oauth.ts with callback handler and status page
  ```

---

## Task 5: Create polling.ts

**Files:**
- Create: `mcp/linear-agent/src/polling.ts`
- Create: `mcp/linear-agent/src/__tests__/polling.test.ts`

### Steps

- [ ] **5.1** Write the test first. Create `src/__tests__/polling.test.ts`:
  ```typescript
  import { describe, it, expect } from "vitest";
  import { deduplicateIssues, type InFlightSession } from "../polling.js";

  describe("deduplicateIssues", () => {
    it("filters out issues that have an in-flight session", () => {
      const issues = [
        { id: "issue-1", identifier: "SC-1", title: "Bug A" },
        { id: "issue-2", identifier: "SC-2", title: "Bug B" },
        { id: "issue-3", identifier: "SC-3", title: "Bug C" },
      ];

      const inFlight: InFlightSession[] = [
        { issueIdentifier: "SC-2", spawnedAt: Date.now() },
      ];

      const result = deduplicateIssues(issues, inFlight);

      expect(result).toHaveLength(2);
      expect(result.map((i) => i.identifier)).toEqual(["SC-1", "SC-3"]);
    });

    it("returns all issues when no sessions are in-flight", () => {
      const issues = [
        { id: "issue-1", identifier: "SC-1", title: "Bug A" },
        { id: "issue-2", identifier: "SC-2", title: "Bug B" },
      ];

      const result = deduplicateIssues(issues, []);

      expect(result).toHaveLength(2);
    });

    it("returns empty array when all issues have in-flight sessions", () => {
      const issues = [
        { id: "issue-1", identifier: "SC-1", title: "Bug A" },
      ];

      const inFlight: InFlightSession[] = [
        { issueIdentifier: "SC-1", spawnedAt: Date.now() },
      ];

      const result = deduplicateIssues(issues, inFlight);

      expect(result).toHaveLength(0);
    });

    it("expires stale sessions older than the TTL", () => {
      const issues = [
        { id: "issue-1", identifier: "SC-1", title: "Bug A" },
      ];

      const ONE_HOUR = 60 * 60 * 1000;
      const inFlight: InFlightSession[] = [
        { issueIdentifier: "SC-1", spawnedAt: Date.now() - ONE_HOUR - 1 },
      ];

      // Default TTL is 30 minutes, so a 1-hour-old session is expired
      const result = deduplicateIssues(issues, inFlight, 30 * 60 * 1000);

      expect(result).toHaveLength(1);
      expect(result[0].identifier).toBe("SC-1");
    });
  });
  ```

- [ ] **5.2** Run the test — verify it fails:
  ```bash
  cd mcp/linear-agent && npx vitest run src/__tests__/polling.test.ts
  ```
  Expected: fails because `src/polling.ts` does not exist.

- [ ] **5.3** Create `src/polling.ts`:
  ```typescript
  import { gql } from "./graphql.js";
  import { spawnClaudeSession } from "./spawn.js";

  export interface InFlightSession {
    issueIdentifier: string;
    spawnedAt: number;
  }

  interface LinearIssue {
    id: string;
    identifier: string;
    title: string;
  }

  const DEFAULT_SESSION_TTL = 30 * 60 * 1000; // 30 minutes

  const inFlightSessions: InFlightSession[] = [];

  export function deduplicateIssues(
    issues: LinearIssue[],
    inFlight: InFlightSession[],
    sessionTtl: number = DEFAULT_SESSION_TTL
  ): LinearIssue[] {
    const now = Date.now();
    // Only consider non-expired sessions
    const activeIdentifiers = new Set(
      inFlight
        .filter((s) => now - s.spawnedAt < sessionTtl)
        .map((s) => s.issueIdentifier)
    );

    return issues.filter((issue) => !activeIdentifiers.has(issue.identifier));
  }

  const TODO_ISSUES_QUERY = `
    query TodoIssues($teamId: String!) {
      issues(
        filter: {
          team: { id: { eq: $teamId } }
          state: { type: { eq: "unstarted" } }
        }
        first: 20
        orderBy: createdAt
      ) {
        nodes {
          id
          identifier
          title
        }
      }
    }
  `;

  export async function pollForIssues(teamId: string): Promise<void> {
    try {
      const data = (await gql(TODO_ISSUES_QUERY, { teamId })) as {
        issues: { nodes: LinearIssue[] };
      };

      const issues = data.issues.nodes;
      if (issues.length === 0) {
        console.log("Poll: no unstarted issues found");
        return;
      }

      const newIssues = deduplicateIssues(issues, inFlightSessions);
      if (newIssues.length === 0) {
        console.log(`Poll: ${issues.length} issues found, all have in-flight sessions`);
        return;
      }

      console.log(`Poll: ${newIssues.length} new issue(s) to process`);

      for (const issue of newIssues) {
        inFlightSessions.push({
          issueIdentifier: issue.identifier,
          spawnedAt: Date.now(),
        });

        const syntheticEvent = {
          type: "PollEvent",
          action: "discovered",
          data: {
            id: `poll-${issue.id}`,
            issueIdentifier: issue.identifier,
            issueId: issue.id,
          },
        };

        spawnClaudeSession(syntheticEvent).catch((err) =>
          console.error(`Poll spawn error for ${issue.identifier}:`, err)
        );
      }
    } catch (err) {
      console.error("Poll error:", err);
    }
  }

  let pollTimer: ReturnType<typeof setInterval> | null = null;

  export function startPolling(teamId: string, intervalMs: number): void {
    if (intervalMs <= 0) {
      console.log("Polling disabled (interval <= 0)");
      return;
    }

    console.log(`Starting polling timer: every ${intervalMs / 1000}s for team ${teamId}`);

    // Run immediately on start
    pollForIssues(teamId).catch((err) => console.error("Initial poll error:", err));

    pollTimer = setInterval(() => {
      // Prune expired sessions before each poll
      const now = Date.now();
      for (let i = inFlightSessions.length - 1; i >= 0; i--) {
        if (now - inFlightSessions[i].spawnedAt >= DEFAULT_SESSION_TTL) {
          inFlightSessions.splice(i, 1);
        }
      }

      pollForIssues(teamId).catch((err) => console.error("Poll error:", err));
    }, intervalMs);
  }

  export function stopPolling(): void {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
      console.log("Polling stopped");
    }
  }
  ```

- [ ] **5.4** Run the test — verify it passes:
  ```bash
  cd mcp/linear-agent && npx vitest run src/__tests__/polling.test.ts
  ```
  Expected: 4 tests pass.

- [ ] **5.5** Verify build:
  ```bash
  cd mcp/linear-agent && npx tsc --noEmit
  ```

- [ ] **5.6** Commit:
  ```
  feat(linear-agent): add polling.ts with deduplication and periodic Linear issue polling
  ```

---

## Task 6: Add .scottclip/.env loading

**Files:**
- Create: `mcp/linear-agent/src/env.ts`
- Create: `mcp/linear-agent/src/__tests__/env.test.ts`

> **Note:** This task was moved before the server rewrite because `server.ts` imports `loadDotEnv` from `./env.js`.

### Steps

- [ ] **6.1** Write the test first. Create `src/__tests__/env.test.ts`:
  ```typescript
  import { describe, it, expect } from "vitest";
  import { parseDotEnv } from "../env.js";

  describe("parseDotEnv", () => {
    it("parses KEY=VALUE lines", () => {
      const content = `
LINEAR_CLIENT_ID=abc123
LINEAR_CLIENT_SECRET=secret456
`;
      const result = parseDotEnv(content);

      expect(result).toEqual({
        LINEAR_CLIENT_ID: "abc123",
        LINEAR_CLIENT_SECRET: "secret456",
      });
    });

    it("ignores comments and blank lines", () => {
      const content = `
# This is a comment
LINEAR_CLIENT_ID=abc123

  # Another comment
LINEAR_CLIENT_SECRET=secret456
`;
      const result = parseDotEnv(content);

      expect(result).toEqual({
        LINEAR_CLIENT_ID: "abc123",
        LINEAR_CLIENT_SECRET: "secret456",
      });
    });

    it("handles quoted values and strips quotes", () => {
      const content = `
LINEAR_CLIENT_ID="abc123"
LINEAR_CLIENT_SECRET='secret456'
`;
      const result = parseDotEnv(content);

      expect(result).toEqual({
        LINEAR_CLIENT_ID: "abc123",
        LINEAR_CLIENT_SECRET: "secret456",
      });
    });

    it("does not override existing env vars", () => {
      const content = `KEY=from_file`;
      const result = parseDotEnv(content);
      expect(result).toEqual({ KEY: "from_file" });
    });

    it("handles values with = signs", () => {
      const content = `DATABASE_URL=postgres://user:pass@host/db?ssl=true`;
      const result = parseDotEnv(content);
      expect(result).toEqual({
        DATABASE_URL: "postgres://user:pass@host/db?ssl=true",
      });
    });
  });
  ```

- [ ] **6.2** Run the test — verify it fails:
  ```bash
  cd mcp/linear-agent && npx vitest run src/__tests__/env.test.ts
  ```

- [ ] **6.3** Create `src/env.ts`:
  ```typescript
  import { readFileSync } from "node:fs";
  import { join } from "node:path";

  export function parseDotEnv(content: string): Record<string, string> {
    const result: Record<string, string> = {};

    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const eqIndex = trimmed.indexOf("=");
      if (eqIndex === -1) continue;

      const key = trimmed.substring(0, eqIndex).trim();
      let value = trimmed.substring(eqIndex + 1).trim();

      // Strip surrounding quotes
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      result[key] = value;
    }

    return result;
  }

  export function loadDotEnv(): void {
    const cwd = process.cwd();
    const envPath = join(cwd, ".scottclip", ".env");

    try {
      const content = readFileSync(envPath, "utf-8");
      const vars = parseDotEnv(content);

      let loaded = 0;
      for (const [key, value] of Object.entries(vars)) {
        // Do not override existing env vars (explicit env takes precedence)
        if (process.env[key] === undefined) {
          process.env[key] = value;
          loaded++;
        }
      }

      if (loaded > 0) {
        console.log(`Loaded ${loaded} env var(s) from ${envPath}`);
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        // .env file not found — not an error, just skip
        console.log(`No .scottclip/.env found in ${cwd} (this is fine for dev/manual mode)`);
      } else {
        console.error(`Error reading ${envPath}:`, err);
      }
    }
  }
  ```

- [ ] **6.4** Run the test — verify it passes:
  ```bash
  cd mcp/linear-agent && npx vitest run src/__tests__/env.test.ts
  ```
  Expected: 5 tests pass.

- [ ] **6.5** Commit:
  ```
  feat(linear-agent): add .scottclip/.env loading with parseDotEnv
  ```

---

## Task 7: Rewrite server.ts as Hono app

**Files:**
- Modify: `mcp/linear-agent/src/server.ts`

### Steps

- [ ] **7.1** Read the current `src/server.ts` to confirm its exact contents before overwriting.

- [ ] **7.2** Rewrite `src/server.ts` with the full Hono-based consolidated server:
  ```typescript
  #!/usr/bin/env node

  import { Hono } from "hono";
  import { serve } from "@hono/node-server";
  import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
  import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
  import { randomUUID } from "node:crypto";
  import { registerIssueTools } from "./tools/issues.js";
  import { registerRelationTools } from "./tools/relations.js";
  import { registerCommentTools } from "./tools/comments.js";
  import { registerLabelTools } from "./tools/labels.js";
  import { registerTeamTools } from "./tools/teams.js";
  import { registerDocumentTools } from "./tools/documents.js";
  import { registerSessionTools } from "./tools/sessions.js";
  import { registerEventTools } from "./tools/events.js";
  import { registerStateTools } from "./tools/states.js";
  import { createWebhookRoute } from "./webhook.js";
  import { createOAuthRoute, createStatusRoute } from "./oauth.js";
  import { startPolling, stopPolling } from "./polling.js";
  import { loadDotEnv } from "./env.js";

  // Load .scottclip/.env before anything reads process.env
  loadDotEnv();

  const PORT = parseInt(process.env.WEBHOOK_PORT || "3847", 10);
  const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL || "900000", 10); // 15 minutes default
  const POLL_TEAM_ID = process.env.POLL_TEAM_ID || "";

  // --- MCP Server Setup ---

  const mcpServer = new McpServer({
    name: "linear-agent",
    version: "0.1.0",
  });

  registerIssueTools(mcpServer);
  registerRelationTools(mcpServer);
  registerCommentTools(mcpServer);
  registerLabelTools(mcpServer);
  registerTeamTools(mcpServer);
  registerDocumentTools(mcpServer);
  registerSessionTools(mcpServer);
  registerEventTools(mcpServer);
  registerStateTools(mcpServer);

  // Track active transports by session ID
  const transports = new Map<string, WebStandardStreamableHTTPServerTransport>();

  // --- Hono App ---

  const app = new Hono();

  // MCP Streamable HTTP endpoint
  app.all("/mcp", async (c) => {
    const sessionId = c.req.header("mcp-session-id");

    if (c.req.method === "GET" || c.req.method === "DELETE") {
      // GET = SSE stream reconnect, DELETE = session close
      if (!sessionId || !transports.has(sessionId)) {
        return c.text("No active session", 400);
      }
      const transport = transports.get(sessionId)!;
      return transport.handleRequest(c.req.raw);
    }

    // POST — either initialize a new session or send to existing one
    if (sessionId && transports.has(sessionId)) {
      const transport = transports.get(sessionId)!;
      return transport.handleRequest(c.req.raw);
    }

    // New session
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        transports.set(id, transport);
        console.log(`MCP session initialized: ${id}`);
      },
      onsessionclosed: (id) => {
        transports.delete(id);
        console.log(`MCP session closed: ${id}`);
      },
    });

    await mcpServer.connect(transport);
    return transport.handleRequest(c.req.raw);
  });

  // Webhook endpoint
  app.route("/webhook", createWebhookRoute());

  // OAuth endpoint
  app.route("/oauth", createOAuthRoute());

  // Status page
  app.route("/", createStatusRoute());

  // --- Start Server ---

  async function main() {
    serve(
      {
        fetch: app.fetch,
        port: PORT,
      },
      (info) => {
        console.log(`ScottClip linear-agent server listening on port ${info.port}`);
        console.log(`  MCP:     http://localhost:${info.port}/mcp`);
        console.log(`  Webhook: http://localhost:${info.port}/webhook`);
        console.log(`  OAuth:   http://localhost:${info.port}/oauth/callback`);
        console.log(`  Status:  http://localhost:${info.port}/`);
      }
    );

    // Start polling if configured
    if (POLL_TEAM_ID && POLL_INTERVAL > 0) {
      startPolling(POLL_TEAM_ID, POLL_INTERVAL);
    } else if (!POLL_TEAM_ID) {
      console.log("Polling disabled: POLL_TEAM_ID not set");
    }

    // Graceful shutdown
    const shutdown = () => {
      console.log("Shutting down...");
      stopPolling();
      for (const [id, transport] of transports) {
        transport.close?.();
        transports.delete(id);
      }
      process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  }

  main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
  ```

- [ ] **7.3** Verify build:
  ```bash
  cd mcp/linear-agent && npx tsc --noEmit
  ```

  If the `WebStandardStreamableHTTPServerTransport` import path differs from the SDK version installed, check the actual export:
  ```bash
  cd mcp/linear-agent && node -e "import('@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js').then(m => console.log(Object.keys(m)))"
  ```
  Adjust the import path if needed.

- [ ] **7.4** Commit:
  ```
  feat(linear-agent): rewrite server.ts as consolidated Hono HTTP server with MCP, webhook, OAuth
  ```

---

## Task 8: Delete webhook/receiver.ts and clean up

**Files:**
- Delete: `mcp/linear-agent/webhook/receiver.ts`
- Delete: `mcp/linear-agent/webhook/` (entire directory)

### Steps

- [ ] **8.1** Delete the webhook directory:
  ```bash
  rm -rf mcp/linear-agent/webhook
  ```

- [ ] **8.2** Search for any remaining imports of `webhook/receiver`:
  ```bash
  cd mcp/linear-agent && grep -r "webhook/receiver" --include="*.ts" --include="*.json" .
  ```
  Expected: no results.

- [ ] **8.3** Search for any references to the old npm scripts:
  ```bash
  cd mcp/linear-agent && grep -r "npm run webhook" --include="*.ts" --include="*.json" --include="*.md" .
  ```
  If any results, update those references to use `npm run start` instead.

- [ ] **8.4** Verify build:
  ```bash
  cd mcp/linear-agent && npx tsc --noEmit
  ```

- [ ] **8.5** Commit:
  ```
  chore(linear-agent): delete webhook/receiver.ts, fully absorbed into consolidated server
  ```

---

## Task 9: Integration test — build and start server

**Files:**
- Create: `mcp/linear-agent/src/__tests__/integration.test.ts`

### Steps

- [ ] **9.1** Run a full build:
  ```bash
  cd mcp/linear-agent && npm run build
  ```
  Expected: exits 0, `dist/` directory populated.

- [ ] **9.2** Create `src/__tests__/integration.test.ts`:
  ```typescript
  import { describe, it, expect, afterAll } from "vitest";

  const PORT = 13847; // Use non-standard port to avoid conflicts

  describe("consolidated server integration", () => {
    let serverProcess: ReturnType<typeof import("node:child_process").spawn> | null = null;

    afterAll(async () => {
      if (serverProcess) {
        serverProcess.kill("SIGTERM");
        // Wait briefly for cleanup
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    });

    it("starts and responds to GET /", async () => {
      const { spawn } = await import("node:child_process");

      serverProcess = spawn("node", ["dist/src/server.js"], {
        env: {
          ...process.env,
          WEBHOOK_PORT: String(PORT),
          // Provide minimal env so auth module doesn't crash
          LINEAR_CLIENT_ID: "test-client-id",
          LINEAR_CLIENT_SECRET: "test-client-secret",
          LINEAR_CALLBACK_HOST: "http://localhost",
        },
        stdio: "pipe",
      });

      // Wait for server to start
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Server startup timeout")), 5000);
        serverProcess!.stdout?.on("data", (data: Buffer) => {
          if (data.toString().includes("listening")) {
            clearTimeout(timeout);
            resolve();
          }
        });
        serverProcess!.stderr?.on("data", (data: Buffer) => {
          // Log stderr for debugging
          process.stderr.write(data);
        });
        serverProcess!.on("error", (err) => {
          clearTimeout(timeout);
          reject(err);
        });
        serverProcess!.on("exit", (code) => {
          if (code !== null && code !== 0) {
            clearTimeout(timeout);
            reject(new Error(`Server exited with code ${code}`));
          }
        });
      });

      // Test GET /
      const statusRes = await fetch(`http://localhost:${PORT}/`);
      expect(statusRes.status).toBe(200);
      const html = await statusRes.text();
      expect(html).toContain("ScottClip Linear Agent");

      // Test POST /webhook with no signature returns 401
      const webhookRes = await fetch(`http://localhost:${PORT}/webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "test" }),
      });
      expect(webhookRes.status).toBe(401);
    });
  });
  ```

- [ ] **9.3** Run the integration test:
  ```bash
  cd mcp/linear-agent && npx vitest run src/__tests__/integration.test.ts --timeout 15000
  ```
  Expected: passes. If the server logs warnings about missing auth config, that is acceptable — the integration test only validates HTTP routing.

- [ ] **9.4** Run the full test suite:
  ```bash
  cd mcp/linear-agent && npm test
  ```
  Expected: all tests pass.

- [ ] **9.5** Commit:
  ```
  test(linear-agent): add integration test for consolidated server startup and routing
  ```

---

## Task 10: Update plugin files (skills, commands, CLAUDE.md)

**Files:**
- Modify: `skills/watch/SKILL.md`
- Modify: `skills/init/SKILL.md`
- Modify: `commands/scottclip-watch.md`
- Modify: `CLAUDE.md`

### Steps

- [ ] **10.1** Read each file before modifying.

- [ ] **10.2** Update `commands/scottclip-watch.md` — remove `--webhook-only` and `--poll-only` flags:
  ```markdown
  ---
  description: Start ScottClip watch mode (consolidated server with webhook + polling)
  argument-hint: "[--interval 15m] [--stop]"
  ---

  Start or stop ScottClip watch mode using the scottclip-watch skill.

  Arguments passed: $ARGUMENTS

  Parse the arguments:
  - `--interval <duration>` -- Server polling interval (default: 15m). Supports s/m/h suffixes.
  - `--stop` -- Stop the server process.

  Execute the watch procedure from the skill.
  ```

- [ ] **10.3** Update `skills/watch/SKILL.md` — rewrite to start the consolidated server instead of separate processes. Key changes:
  - Remove `--webhook-only` and `--poll-only` flags
  - Replace "Start Webhook Receiver" step with "Start Consolidated Server"
  - Remove "Start Polling Loop" step (polling is built into the server)
  - The server is started via `npm run start` from the linear-agent directory
  - Pass `POLL_INTERVAL` env var derived from `--interval` flag
  - Pass `POLL_TEAM_ID` from `.scottclip/config.yaml`
  - Server binds port 3847, serves MCP + webhook + OAuth
  - `--stop` kills the process on port 3847

  Preserve the SKILL.md frontmatter format. Update the description to reflect consolidated server.

- [ ] **10.4** Update `skills/init/SKILL.md` — key changes:
  - Phase 1 Step 2: Write **global** `~/.claude/.mcp.json` with `url` key (HTTP transport) instead of `command`/`args`/`env`:
    ```json
    {
      "mcpServers": {
        "linear-agent": {
          "url": "http://localhost:3847/mcp"
        }
      }
    }
    ```
  - Phase 1 Step 2: Write `.scottclip/.env` with credentials:
    ```
    LINEAR_CLIENT_ID=<client_id>
    LINEAR_CLIENT_SECRET=<client_secret>
    LINEAR_WEBHOOK_SECRET=
    LINEAR_CALLBACK_HOST=<tunnel_hostname>
    ```
  - Phase 1 Step 3: Start the consolidated server (`npm run start`) instead of `npm run webhook:restart`
  - Remove references to per-repo `.mcp.json` — all MCP config is global
  - Phase 2 Step 6: Update webhook secret in `.scottclip/.env` instead of `.mcp.json`

- [ ] **10.5** Update `CLAUDE.md` — update the Architecture section to reflect:
  - Single HTTP server (not stdio transport)
  - `src/spawn.ts`, `src/webhook.ts`, `src/oauth.ts`, `src/polling.ts`, `src/env.ts` as new modules
  - `webhook/receiver.ts` deleted
  - Global `~/.claude/.mcp.json` with URL, `.scottclip/.env` for credentials
  - npm scripts: `start`, `stop`, `start:tunnel`, `test`

- [ ] **10.6** Verify all YAML/frontmatter in modified skill files parses cleanly:
  ```bash
  python3 -c "
  import yaml
  for f in ['skills/watch/SKILL.md', 'skills/init/SKILL.md']:
      with open(f) as fh:
          content = fh.read()
          # Extract frontmatter between --- markers
          parts = content.split('---', 2)
          if len(parts) >= 3:
              yaml.safe_load(parts[1])
              print(f'{f}: OK')
  "
  ```

- [ ] **10.7** Commit:
  ```
  docs(scottclip): update skills, commands, and CLAUDE.md for consolidated server architecture
  ```

---

## Summary

| Task | Creates | Tests | Key change |
|------|---------|-------|------------|
| 1 | vitest.config.ts | - | Add hono, @hono/node-server, vitest deps; update scripts |
| 2 | src/spawn.ts | 3 | Extract spawnClaudeSession, ackSession, buildClaudeArgs |
| 3 | src/webhook.ts | 4 | Extract HMAC verification + event handler as Hono route |
| 4 | src/oauth.ts | - | Extract OAuth callback + status page as Hono routes |
| 5 | src/polling.ts | 4 | Deduplication logic + periodic Linear polling |
| 6 | src/env.ts | 5 | .scottclip/.env parser and loader |
| 7 | (rewrite) src/server.ts | - | Hono app with WebStandardStreamableHTTPServerTransport |
| 8 | - | - | Delete webhook/ directory |
| 9 | src/__tests__/integration.test.ts | 1 | End-to-end server startup + route verification |
| 10 | - | - | Update plugin skills, commands, CLAUDE.md |

**Total new files:** 9 (4 source modules, 4 test files, 1 vitest config)
**Total deleted files:** 1 (webhook/receiver.ts + directory)
**Total modified files:** 5 (server.ts, package.json, tsconfig.json, 2 skills, 1 command, CLAUDE.md)
**Total tests:** 17
**Total commits:** 10
