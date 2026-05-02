import { describe, it, expect } from "vitest";
import { buildClaudeArgs, buildResumePrompt } from "../spawn.js";

describe("buildClaudeArgs", () => {
  it("builds prompt from a real Linear webhook event", () => {
    const event = {
      type: "AgentSessionEvent",
      action: "prompted",
      agentSession: {
        id: "session-123",
        issue: {
          id: "issue-abc",
          identifier: "SC-42",
          title: "Fix login bug",
          url: "https://linear.app/team/issue/SC-42",
          description: "The login page throws a 500 error",
        },
        comment: {
          body: "@agent fix this please",
        },
        creator: {
          name: "Scott",
        },
      },
      promptContext: "<issue>some xml context</issue>",
    };

    const result = buildClaudeArgs(event);

    expect(result.prompt).toContain("Session ID: session-123");
    expect(result.prompt).toContain("SC-42 — Fix login bug");
    expect(result.prompt).toContain("Message from Scott");
    expect(result.prompt).toContain("@agent fix this please");
    expect(result.prompt).toContain("Issue Description");
    expect(result.prompt).toContain("500 error");
    expect(result.prompt).toContain("some xml context");
    expect(result.prompt).toContain("Do NOT run /heartbeat");
    expect(result.prompt).toContain(`agentSessionId: "session-123"`);
    expect(result.cliArgs).toContain("-p");
    expect(result.cliArgs).toContain("--allowedTools");
  });

  it("handles minimal event with missing optional fields", () => {
    const event = {
      type: "AgentSessionEvent",
      action: "created",
      agentSession: {
        id: "session-456",
      },
    };

    const result = buildClaudeArgs(event);

    expect(result.prompt).toContain("Issue: unknown");
    expect(result.prompt).not.toContain("Message from");
    expect(result.prompt).not.toContain("Issue Description");
    expect(result.prompt).not.toContain("Previous Comments");
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

    expect(result.prompt).toContain("SC-99");
  });

  it("includes previous comments and guidance when present", () => {
    const event = {
      type: "AgentSessionEvent",
      action: "prompted",
      agentSession: {
        id: "session-999",
        issue: { identifier: "SC-1", title: "Test" },
        comment: { body: "do the thing" },
      },
      previousComments: [
        { body: "first comment", user: { name: "Alice" } },
        { body: "second comment", user: { name: "Bob" } },
      ],
      guidance: "Always use TypeScript",
    };

    const result = buildClaudeArgs(event);

    expect(result.prompt).toContain("Recent Comments");
    expect(result.prompt).toContain("**Alice:** first comment");
    expect(result.prompt).toContain("**Bob:** second comment");
    expect(result.prompt).toContain("Workspace Guidance");
    expect(result.prompt).toContain("Always use TypeScript");
  });
});

describe("buildResumePrompt", () => {
  it("uses agentActivity.content.body for follow-up comment on prompted events, not session.comment.body", () => {
    // Mirrors a real Linear AgentSessionEvent with action "prompted":
    // agentSession.comment.body = the ORIGINAL session-creating comment (stale)
    // agentActivity.content.body = the NEW follow-up comment (Linear SDK: AgentActivityPromptContent)
    const event = {
      type: "AgentSessionEvent",
      action: "prompted",
      agentSession: {
        id: "session-abc",
        comment: {
          body: "ORIGINAL",
        },
        creator: {
          name: "Scott",
        },
      },
      agentActivity: {
        content: { type: "prompt", body: "FOLLOWUP" },
      },
    };

    const prompt = buildResumePrompt(event);

    expect(prompt).toContain("FOLLOWUP");
    expect(prompt).not.toContain("ORIGINAL");
  });

  it("falls back to session.comment.body when agentActivity.content.body is absent", () => {
    const event = {
      type: "AgentSessionEvent",
      action: "created",
      agentSession: {
        id: "session-xyz",
        comment: {
          body: "FIRST_COMMENT",
        },
        creator: {
          name: "Alice",
        },
      },
      // no agentActivity
    };

    const prompt = buildResumePrompt(event);

    expect(prompt).toContain("FIRST_COMMENT");
  });
});
