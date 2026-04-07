import { describe, it, expect } from "vitest";
import { buildClaudeArgs } from "../spawn.js";

describe("buildClaudeArgs", () => {
  it("builds correct CLI args for a real Linear webhook event", () => {
    const event = {
      type: "AgentSessionEvent",
      action: "prompted",
      agentSession: {
        id: "session-123",
        issue: {
          id: "issue-abc",
          identifier: "SC-42",
          title: "Fix login bug",
        },
        comment: {
          body: "Fix the login bug",
        },
      },
    };

    const result = buildClaudeArgs(event);

    expect(result.prompt).toContain("Linear agent event: AgentSessionEvent (prompted)");
    expect(result.prompt).toContain("Session: session-123");
    expect(result.prompt).toContain("Issue: SC-42");
    expect(result.prompt).toContain("User message: Fix the login bug");
    expect(result.prompt).toContain("/heartbeat --issue SC-42");
    expect(result.cliArgs).toContain("-p");
    expect(result.cliArgs).toContain("--allowedTools");
  });

  it("handles missing optional fields gracefully", () => {
    const event = {
      type: "AgentSessionEvent",
      action: "created",
      agentSession: {
        id: "session-456",
      },
    };

    const result = buildClaudeArgs(event);

    expect(result.prompt).toContain("Issue: unknown");
    expect(result.prompt).not.toContain("User message:");
    expect(result.prompt).not.toContain("Context:");
  });

  it("falls back to event.data for synthetic events", () => {
    const event = {
      type: "PollEvent",
      action: "discovered",
      data: {
        id: "poll-789",
        issueIdentifier: "SC-99",
        issueId: "abc-def",
      },
    };

    const result = buildClaudeArgs(event);

    expect(result.prompt).toContain("Issue: SC-99");
  });
});
