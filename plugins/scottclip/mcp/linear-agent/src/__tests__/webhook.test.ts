import { describe, it, expect } from "vitest";
import { verifySignature, getAutoReactConfig, classifyIssueEvent } from "../webhook.js";
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

  it("returns 'create' when no actor field present", () => {
    const event = {
      type: "Issue",
      action: "create",
      data: { id: "issue-1", teamId: "team-1" },
    };
    expect(classifyIssueEvent(event)).toBe("create");
  });
});
