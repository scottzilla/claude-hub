import { describe, it, expect } from "vitest";
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
