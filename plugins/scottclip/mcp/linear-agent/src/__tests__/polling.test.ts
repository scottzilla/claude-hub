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
    expect(result.map((i: { identifier: string }) => i.identifier)).toEqual(["SC-1", "SC-3"]);
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
