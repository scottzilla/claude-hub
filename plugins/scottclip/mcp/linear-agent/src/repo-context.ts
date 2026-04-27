export interface RepoContext {
  teamId: string;
  cwd: string;
  configPath: string;
  organizationId: string;
}

export function extractTeamId(event: Record<string, unknown>): string | null {
  const agentSession = event.agentSession as Record<string, unknown> | undefined;
  const data = event.data as Record<string, unknown> | undefined;

  // 1. AgentSessionEvent: agentSession.issue.teamId
  const sessionIssue = agentSession?.issue as Record<string, unknown> | undefined;
  if (typeof sessionIssue?.teamId === "string") return sessionIssue.teamId;

  // 2. AgentSessionEvent with nested team: agentSession.issue.team.id
  const sessionIssueTeam = sessionIssue?.team as Record<string, unknown> | undefined;
  if (typeof sessionIssueTeam?.id === "string") return sessionIssueTeam.id;

  // 3. Synthetic event: data.issue.teamId
  const dataIssue = data?.issue as Record<string, unknown> | undefined;
  if (typeof dataIssue?.teamId === "string") return dataIssue.teamId;

  // 4. Issue webhook: data.teamId
  if (typeof data?.teamId === "string") return data.teamId;

  return null;
}
