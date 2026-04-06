import { gql } from "./graphql.js";
import { spawnClaudeSession } from "./spawn.js";

export interface InFlightSession {
  issueIdentifier: string;
  spawnedAt: number;
}

interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
}

const DEFAULT_SESSION_TTL = 30 * 60 * 1000; // 30 minutes

const inFlightSessions: InFlightSession[] = [];

export function deduplicateIssues(
  issues: LinearIssue[],
  inFlight: InFlightSession[],
  sessionTtl: number = DEFAULT_SESSION_TTL
): LinearIssue[] {
  const now = Date.now();
  // Only consider non-expired sessions
  const activeIdentifiers = new Set(
    inFlight
      .filter((s) => now - s.spawnedAt < sessionTtl)
      .map((s) => s.issueIdentifier)
  );

  return issues.filter((issue) => !activeIdentifiers.has(issue.identifier));
}

const TODO_ISSUES_QUERY = `
  query TodoIssues($teamId: String!) {
    issues(
      filter: {
        team: { id: { eq: $teamId } }
        state: { type: { eq: "unstarted" } }
      }
      first: 20
      orderBy: createdAt
    ) {
      nodes {
        id
        identifier
        title
      }
    }
  }
`;

export async function pollForIssues(teamId: string): Promise<void> {
  try {
    const data = (await gql(TODO_ISSUES_QUERY, { teamId })) as {
      issues: { nodes: LinearIssue[] };
    };

    const issues = data.issues.nodes;
    if (issues.length === 0) {
      console.log("Poll: no unstarted issues found");
      return;
    }

    const newIssues = deduplicateIssues(issues, inFlightSessions);
    if (newIssues.length === 0) {
      console.log(`Poll: ${issues.length} issues found, all have in-flight sessions`);
      return;
    }

    console.log(`Poll: ${newIssues.length} new issue(s) to process`);

    for (const issue of newIssues) {
      inFlightSessions.push({
        issueIdentifier: issue.identifier,
        spawnedAt: Date.now(),
      });

      const syntheticEvent = {
        type: "PollEvent",
        action: "discovered",
        data: {
          id: `poll-${issue.id}`,
          issueIdentifier: issue.identifier,
          issueId: issue.id,
        },
      };

      spawnClaudeSession(syntheticEvent).catch((err) =>
        console.error(`Poll spawn error for ${issue.identifier}:`, err)
      );
    }
  } catch (err) {
    console.error("Poll error:", err);
  }
}

let pollTimer: ReturnType<typeof setInterval> | null = null;

export function startPolling(teamId: string, intervalMs: number): void {
  if (intervalMs <= 0) {
    console.log("Polling disabled (interval <= 0)");
    return;
  }

  console.log(`Starting polling timer: every ${intervalMs / 1000}s for team ${teamId}`);

  // Run immediately on start
  pollForIssues(teamId).catch((err) => console.error("Initial poll error:", err));

  pollTimer = setInterval(() => {
    // Prune expired sessions before each poll
    const now = Date.now();
    for (let i = inFlightSessions.length - 1; i >= 0; i--) {
      if (now - inFlightSessions[i].spawnedAt >= DEFAULT_SESSION_TTL) {
        inFlightSessions.splice(i, 1);
      }
    }

    pollForIssues(teamId).catch((err) => console.error("Poll error:", err));
  }, intervalMs);
}

export function stopPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
    console.log("Polling stopped");
  }
}
