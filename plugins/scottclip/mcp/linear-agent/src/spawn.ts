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

  const issueIdentifier = (issue?.identifier || session?.issueIdentifier || session?.issueId || "unknown") as string;
  const sessionId = (session?.id || "unknown") as string;
  const eventType = (event.type as string) || "unknown";
  const action = (event.action as string) || "unknown";

  const promptBody = comment?.body as string | undefined;
  const promptContext = session?.promptContext as string | undefined;

  const lines = [
    `Linear agent event: ${eventType} (${action})`,
    `Session: ${sessionId}`,
    `Issue: ${issueIdentifier}`,
  ];

  if (promptBody) {
    lines.push("", `User message: ${promptBody}`);
  }
  if (promptContext) {
    lines.push("", "Context:", promptContext);
  }

  lines.push(
    "",
    `Run /heartbeat --issue ${issueIdentifier} to process this issue. The agent session is already acknowledged.`
  );

  const prompt = lines.join("\n");

  const cliArgs = [
    "-p",
    prompt,
    "--allowedTools",
    "mcp__linear_agent*,Read,Write,Edit,Bash,Grep,Glob,Agent",
  ];

  return { prompt, cliArgs };
}

export async function ackSession(sessionId: string, message = "Starting up..."): Promise<void> {
  try {
    await gql(ACK_MUTATION, {
      input: {
        agentSessionId: sessionId,
        content: { body: message },
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
