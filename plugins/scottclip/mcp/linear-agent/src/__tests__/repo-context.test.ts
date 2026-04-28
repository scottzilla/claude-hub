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

  it("returns null when teamId is an empty string", () => {
    const event = { data: { teamId: "" } };
    expect(extractTeamId(event)).toBeNull();
  });

  it("returns null when teamId is not a string (e.g. number)", () => {
    const event = { data: { teamId: 42 } };
    expect(extractTeamId(event)).toBeNull();
  });
});
