import { spawn } from "node:child_process";
import { gql } from "./graphql.js";

const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";

const ACK_MUTATION = `
  mutation AckSession($input: AgentActivityCreateInput!) {
    agentActivityCreate(input: $input) {
      success
    }
  }
`;

export interface ClaudeArgs {
  prompt: string;
  cliArgs: string[];
}

export function buildClaudeArgs(event: Record<string, unknown>): ClaudeArgs {
  // Linear webhook uses event.agentSession, synthetic events may use event.data
  const session = (event.agentSession || event.data) as Record<string, unknown> | undefined;
  const issue = session?.issue as Record<string, unknown> | undefined;
  const comment = session?.comment as Record<string, unknown> | undefined;
  const creator = session?.creator as Record<string, unknown> | undefined;
  const previousComments = event.previousComments as Array<Record<string, unknown>> | undefined;
  const guidance = event.guidance as string | undefined;
  const promptContext = event.promptContext as string | undefined;

  const issueIdentifier = (issue?.identifier || session?.issueIdentifier || session?.issueId || "unknown") as string;
  const issueTitle = (issue?.title || "unknown") as string;
  const issueDescription = issue?.description as string | undefined;
  const issueUrl = (issue?.url || session?.url || "") as string;
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
  ];

  if (issueUrl) {
    lines.push(`- URL: ${issueUrl}`);
  }

  if (issueDescription) {
    lines.push(``, `## Issue Description`, issueDescription);
  }

  if (userMessage) {
    lines.push(``, `## Message from ${userName}`, userMessage);
  }

  if (previousComments && previousComments.length > 0) {
    lines.push(``, `## Previous Comments`);
    for (const c of previousComments) {
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
    `## Instructions`,
    `Respond to this request directly. Use linear-agent MCP tools to:`,
    `- Read the full issue if you need more context (linear_get_issue)`,
    `- Post a comment with your response (linear_save_comment)`,
    `- Update the issue state if appropriate (linear_save_issue)`,
    `- Report progress via the agent session (linear_create_activity with agentSessionId: "${sessionId}")`,
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

  const data = event.data as Record<string, unknown> | undefined;
  const issueIdentifier = (data?.issueIdentifier || data?.issueId || "unknown") as string;
  const sessionId = (data?.id || "unknown") as string;

  const { cliArgs } = buildClaudeArgs(event);

  console.log(`Spawning Claude for ${issueIdentifier} (session ${sessionId})`);

  const child = spawn(CLAUDE_BIN, cliArgs, {
    cwd: targetRepo,
    stdio: "ignore",
    detached: true,
    env: { ...process.env },
  });

  child.unref();

  child.on("error", (err) => {
    console.error(`Failed to spawn Claude for ${issueIdentifier}:`, err);
  });
}
