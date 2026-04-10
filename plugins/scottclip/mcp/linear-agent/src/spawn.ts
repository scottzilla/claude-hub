import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { gql } from "./graphql.js";

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

  const prompt = lines.join("\n");

  const cliArgs = [
    "-p",
    prompt,
    "--allowedTools",
    "mcp__linear-agent*,Read,Write,Edit,Bash,Grep,Glob,Agent",
  ];

  return { prompt, cliArgs };
}

const UPDATE_ISSUE_MUTATION = `
  mutation UpdateIssue($id: String!, $input: IssueUpdateInput!) {
    issueUpdate(id: $id, input: $input) {
      success
    }
  }
`;

export async function moveIssueToState(issueId: string, teamId: string, stateName: string): Promise<void> {
  try {
    const { resolveStateName } = await import("./state-cache.js");
    const stateId = await resolveStateName(teamId, stateName);
    await gql(UPDATE_ISSUE_MUTATION, { id: issueId, input: { stateId } });
    console.log(`Moved issue ${issueId} to "${stateName}"`);
  } catch (err) {
    console.error(`Failed to move issue to "${stateName}":`, err);
  }
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

  // Fetch full issue with labels before spawning
  let fetchedIssue: IssueData | null = null;
  if (issueId) {
    console.log(`Fetching issue ${issueIdentifier} (${issueId}) before spawn...`);
    fetchedIssue = await fetchIssue(issueId);
  }

  const { prompt } = buildClaudeArgs(event, fetchedIssue);

  console.log(`Spawning Claude for ${issueIdentifier} (session ${sessionId})`);

  // Ack session immediately
  await ackSession(sessionId);

  // Write prompt to file for logging
  const sessionsDir = join(targetRepo, ".scottclip", "sessions");
  await mkdir(sessionsDir, { recursive: true });
  const logPath = join(sessionsDir, `${sessionId}.log`);

  // Track activity debounce
  let lastTextPostTime = 0;
  const TEXT_DEBOUNCE_MS = 3000;

  try {
    let finalResult = "";

    for await (const message of query({
      prompt,
      options: {
        cwd: targetRepo,
        allowedTools: ["mcp__linear-agent*", "Read", "Write", "Edit", "Bash", "Grep", "Glob", "Agent"],
        permissionMode: "bypassPermissions",
        settingSources: ["project"],
      },
    } as any)) {
      const msg = message as Record<string, unknown>;
      const type = msg.type as string;

      if (type === "assistant") {
        // Post ephemeral activities for assistant turns
        const content = (msg.message as any)?.content as Array<Record<string, unknown>> | undefined;
        if (!Array.isArray(content)) continue;

        for (const block of content) {
          if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
            const now = Date.now();
            if (now - lastTextPostTime >= TEXT_DEBOUNCE_MS) {
              lastTextPostTime = now;
              ackSession(sessionId, block.text.trim()).catch((err: Error) =>
                console.error("Failed to post text activity:", err),
              );
            }
          } else if (block.type === "tool_use" && typeof block.name === "string") {
            const input = block.input as Record<string, unknown> | undefined;
            const param = input ? JSON.stringify(input).slice(0, 500) : "";
            gql(ACK_MUTATION, {
              input: {
                agentSessionId: sessionId,
                content: { type: "action", action: block.name, parameter: param },
                ephemeral: true,
              },
            }).catch((err: Error) => console.error("Failed to post tool activity:", err));
          }
        }
      } else if (type === "result") {
        if (typeof msg.result === "string") {
          finalResult = msg.result;
        }
      }
    }

    // Post final response
    if (finalResult.trim()) {
      await gql(ACK_MUTATION, {
        input: {
          agentSessionId: sessionId,
          content: { type: "response", body: finalResult.trim() },
        },
      }).catch((err: Error) => console.error("Failed to post final activity:", err));
    }

    // Write result to log
    await writeFile(logPath, finalResult || "(no result)");
    console.log(`Session ${sessionId} completed for ${issueIdentifier}`);

  } catch (err) {
    console.error(`Session ${sessionId} failed for ${issueIdentifier}:`, err);
    await writeFile(logPath, `Error: ${err instanceof Error ? err.message : String(err)}`);
  }
}
