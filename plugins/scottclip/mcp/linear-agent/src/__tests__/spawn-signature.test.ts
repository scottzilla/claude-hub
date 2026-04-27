import { describe, it, expect } from "vitest";
import type { RepoContext } from "../repo-context.js";

describe("spawnClaudeSession signature", () => {
  it("accepts (event, ctx) without TypeScript errors at runtime", async () => {
    const { spawnClaudeSession } = await import("../spawn.js");
    expect(typeof spawnClaudeSession).toBe("function");
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
