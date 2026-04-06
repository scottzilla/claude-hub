import { spawn } from "node:child_process";
import { gql } from "./graphql.js";

const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";
const TARGET_REPO = process.env.AGENT_CWD;

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
  const data = event.data as Record<string, unknown> | undefined;
  const issueIdentifier = (data?.issueIdentifier || data?.issueId || "unknown") as string;
  const sessionId = (data?.id || "unknown") as string;
  const eventType = (event.type as string) || "unknown";
  const action = (event.action as string) || "unknown";

  const activity = data?.agentActivity as Record<string, unknown> | undefined;
  const promptBody = activity?.body as string | undefined;
  const promptContext = data?.promptContext as string | undefined;

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
        sessionId,
        type: "thought",
        body: message,
        ephemeral: true,
      },
    });
    console.log(`Acked session ${sessionId}`);
  } catch (err) {
    console.error(`Failed to ack session ${sessionId}:`, err);
  }
}

export async function spawnClaudeSession(event: Record<string, unknown>): Promise<void> {
  if (!TARGET_REPO) {
    console.error("AGENT_CWD not set — cannot spawn Claude session");
    return;
  }

  const data = event.data as Record<string, unknown> | undefined;
  const issueIdentifier = (data?.issueIdentifier || data?.issueId || "unknown") as string;
  const sessionId = (data?.id || "unknown") as string;

  const { cliArgs } = buildClaudeArgs(event);

  console.log(`Spawning Claude for ${issueIdentifier} (session ${sessionId})`);

  const child = spawn(CLAUDE_BIN, cliArgs, {
    cwd: TARGET_REPO,
    stdio: "ignore",
    detached: true,
    env: { ...process.env },
  });

  child.unref();

  child.on("error", (err) => {
    console.error(`Failed to spawn Claude for ${issueIdentifier}:`, err);
  });
}
