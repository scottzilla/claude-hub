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
  vi.useRealTimers();
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
    expect(ctx.teamId).toBe("team-anything"); // from event payload
    expect(ctx.organizationId).toBe("legacy"); // still the legacy marker
  });
});

describe("webhook routing — per-team debouncer", () => {
  it("creates a separate debouncer instance per teamId", async () => {
    const { register } = await import("../registry.js");
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
  });
});
