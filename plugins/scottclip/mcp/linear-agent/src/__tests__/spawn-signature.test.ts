import { describe, it, expect } from "vitest";

describe("spawnClaudeSession signature", () => {
  it("accepts (event, ctx) without TypeScript errors at runtime", async () => {
    const { spawnClaudeSession } = await import("../spawn.js");
    expect(typeof spawnClaudeSession).toBe("function");
    expect(spawnClaudeSession.length).toBe(2);
  });
});
