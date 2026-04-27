import { describe, it, expect } from "vitest";
import type { RepoContext } from "../repo-context.js";

// Compile-time check that RepoContext is exported and importable.
// (If the type were removed or renamed, this file would fail to compile.)
type _AssertRepoContext = RepoContext;

describe("spawnClaudeSession signature", () => {
  it("accepts (event, ctx) without TypeScript errors at runtime", async () => {
    const { spawnClaudeSession } = await import("../spawn.js");
    expect(typeof spawnClaudeSession).toBe("function");
    expect(spawnClaudeSession.length).toBe(2);
  });
});
