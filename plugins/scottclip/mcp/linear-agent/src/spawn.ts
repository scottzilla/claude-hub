import { spawn } from "node:child_process";
import { writeFile, mkdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { gql } from "./graphql.js";

const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";

const ACK_MUTATION = `
  mutation AckSession($input: AgentActivityCreateInput!) {
    agentActivityCreate(input: $input) {
      success
    }
  }
`;

const GET_ISSUE_QUERY = `
  query GetIssue($id: String!) {
    issue(id: $id) {
      id
      identifier
      title
      description
      url
      priority
      priorityLabel
      state { id name type }
      assignee { id name }
      labels { nodes { id name } }
      parent { id identifier title }
      comments(first: 10, orderBy: createdAt) {
        nodes {
          id
          body
          user { id name }
          createdAt
        }
      }
      attachments { nodes { id title url subtitle metadata } }
    }
  }
`;

export interface ClaudeArgs {
  prompt: string;
  cliArgs: string[];
}

interface IssueData {
  id: string;
  identifier: string;
  title: string;
  description?: string;
  url?: string;
  priority?: number;
  priorityLabel?: string;
  state?: { id: string; name: string; type: string };
  assignee?: { id: string; name: string };
  labels?: { nodes: Array<{ id: string; name: string }> };
  parent?: { id: string; identifier: string; title: string };
  comments?: { nodes: Array<{ id: string; body: string; user: { id: string; name: string }; createdAt: string }> };
  attachments?: { nodes: Array<{ id: string; title: string; url: string; subtitle?: string; metadata?: Record<string, unknown> }> };
}

async function fetchIssue(issueId: string): Promise<IssueData | null> {
  try {
    const data = await gql<{ issue: IssueData }>(GET_ISSUE_QUERY, { id: issueId });
    return data.issue;
  } catch (err) {
    console.error(`Failed to fetch issue ${issueId}:`, err);
    return null;
  }
}

export function buildClaudeArgs(
  event: Record<string, unknown>,
  fetchedIssue?: IssueData | null,
): ClaudeArgs {
  // Linear webhook uses event.agentSession, synthetic events may use event.data
  const session = (event.agentSession || event.data) as Record<string, unknown> | undefined;
  const webhookIssue = session?.issue as Record<string, unknown> | undefined;
  const comment = session?.comment as Record<string, unknown> | undefined;
  const creator = session?.creator as Record<string, unknown> | undefined;
  const previousComments = event.previousComments as Array<Record<string, unknown>> | undefined;
  const guidance = event.guidance as string | undefined;
  const promptContext = event.promptContext as string | undefined;

  // Prefer fetched issue (has labels, full details) over webhook snippet
  const issueIdentifier = fetchedIssue?.identifier || (webhookIssue?.identifier as string) || (session?.issueIdentifier as string) || "unknown";
  const issueTitle = fetchedIssue?.title || (webhookIssue?.title as string) || "unknown";
  const issueDescription = fetchedIssue?.description || (webhookIssue?.description as string) || undefined;
  const issueUrl = fetchedIssue?.url || (webhookIssue?.url as string) || (session?.url as string) || "";
  const issueState = fetchedIssue?.state?.name || "unknown";
  const issueLabels = fetchedIssue?.labels?.nodes?.map((l) => l.name) || [];
  const sessionId = (session?.id || "unknown") as string;
  const action = (event.action as string) || "unknown";
  const userMessage = comment?.body as string | undefined;
  const userName = (creator?.name || "someone") as string;

  const lines = [
    `You are responding to a Linear agent session.`,
    ``,
    `## Session`,
    `- Session ID: ${sessionId}`,
    `- Action: ${action}`,
    `- Issue: ${issueIdentifier} — ${issueTitle}`,
    `- State: ${issueState}`,
  ];

  if (issueLabels.length > 0) {
    lines.push(`- Labels: ${issueLabels.join(", ")}`);
  }

  if (issueUrl) {
    lines.push(`- URL: ${issueUrl}`);
  }

  if (issueDescription) {
    lines.push(``, `## Issue Description`, issueDescription);
  }

  const attachments = fetchedIssue?.attachments?.nodes || [];
  if (attachments.length > 0) {
    lines.push(``, `## Attachments`);
    for (const a of attachments) {
      const suffix = a.subtitle ? ` — ${a.subtitle}` : "";
      lines.push(`- [${a.title}](${a.url})${suffix}`);
    }
  }

  if (userMessage) {
    lines.push(``, `## Message from ${userName}`, userMessage);
  }

  // Use fetched comments if we have them and no previousComments from webhook
  const commentsToShow = previousComments && previousComments.length > 0
    ? previousComments
    : fetchedIssue?.comments?.nodes?.map((c) => ({ body: c.body, user: { name: c.user?.name || "unknown" } })) || [];

  if (commentsToShow.length > 0) {
    lines.push(``, `## Recent Comments`);
    for (const c of commentsToShow) {
      const author = (c.user as Record<string, unknown>)?.name || "unknown";
      lines.push(`**${author}:** ${c.body}`);
    }
  }

  if (promptContext) {
    lines.push(``, `## Context`, promptContext);
  }

  if (guidance) {
    lines.push(``, `## Workspace Guidance`, guidance);
  }

  lines.push(
    ``,
    `## Persona Resolution`,
    ``,
    `1. Read .scottclip/config.yaml to get the personas map (label → persona directory)`,
    `2. Match issue labels [${issueLabels.join(", ")}] to a persona`,
    `3. If a persona matches: spawn a persona-worker Agent with AGENT_HOME set to the persona directory`,
    `   - The persona-worker reads SOUL.md for identity, TOOLS.md for tool constraints`,
    `   - Pass all session context (session ID, issue, user message) to the worker`,
    `4. If no persona label: act as the orchestrator — triage, apply label, then spawn worker`,
    ``,
    `## Session Reporting`,
    ``,
    `Use linear_create_activity with agentSessionId: "${sessionId}" to report progress.`,
    `Use linear_save_comment to post responses on the issue.`,
    ``,
    `Do NOT run /heartbeat. You have all the context you need.`,
  );

  const prompt = lines.join("\n");

  const cliArgs = [
    "-p",
    prompt,
    "--allowedTools",
    "mcp__linear-agent*,Read,Write,Edit,Bash,Grep,Glob,Agent",
  ];

  return { prompt, cliArgs };
}

export async function ackSession(sessionId: string, message = "Starting up..."): Promise<void> {
  try {
    await gql(ACK_MUTATION, {
      input: {
        agentSessionId: sessionId,
        content: { type: "thought", body: message },
        ephemeral: true,
      },
    });
    console.log(`Acked session ${sessionId}`);
  } catch (err) {
    console.error(`Failed to ack session ${sessionId}:`, err);
  }
}

export async function spawnClaudeSession(event: Record<string, unknown>): Promise<void> {
  const targetRepo = process.env.AGENT_CWD;
  if (!targetRepo) {
    console.error("AGENT_CWD not set — cannot spawn Claude session");
    return;
  }

  const session = (event.agentSession || event.data) as Record<string, unknown> | undefined;
  const webhookIssue = session?.issue as Record<string, unknown> | undefined;
  const issueId = (webhookIssue?.id || session?.issueId || "") as string;
  const issueIdentifier = (webhookIssue?.identifier || session?.issueIdentifier || "unknown") as string;
  const sessionId = (session?.id || "unknown") as string;

  // Fetch full issue with labels before spawning (saves LLM tokens)
  let fetchedIssue: IssueData | null = null;
  if (issueId) {
    console.log(`Fetching issue ${issueIdentifier} (${issueId}) before spawn...`);
    fetchedIssue = await fetchIssue(issueId);
  }

  const { cliArgs } = buildClaudeArgs(event, fetchedIssue);

  console.log(`Spawning Claude for ${issueIdentifier} (session ${sessionId})`);

  // Log spawned session output for debugging
  const logDir = join(targetRepo, ".scottclip", "sessions");
  await mkdir(logDir, { recursive: true });
  const logPath = join(logDir, `${sessionId}.log`);

  // Use shell to redirect output to log file
  const shellCmd = `${CLAUDE_BIN} ${cliArgs.map(a => `'${a.replace(/'/g, "'\\''")}'`).join(" ")} > "${logPath}" 2>&1`;
  const child = spawn("sh", ["-c", shellCmd], {
    cwd: targetRepo,
    stdio: "ignore",
    detached: true,
    env: { ...process.env },
  });

  child.unref();

  // Write session file so stop handler can kill the process
  const sessionsDir = join(targetRepo, ".scottclip", "sessions");
  await mkdir(sessionsDir, { recursive: true });
  const sessionFile = join(sessionsDir, `${sessionId}.pid`);
  await writeFile(sessionFile, String(child.pid));
  console.log(`Session file written: ${sessionFile} (PID ${child.pid})`);

  child.on("exit", async () => {
    try {
      await unlink(sessionFile);
      console.log(`Session ${sessionId} exited, cleaned up ${sessionFile}`);
    } catch {
      // File may already be removed by stop handler
    }
  });

  child.on("error", (err) => {
    console.error(`Failed to spawn Claude for ${issueIdentifier}:`, err);
  });
}
