import { spawn } from "node:child_process";
import { writeFile, mkdir, unlink, readFile } from "node:fs/promises";
import { createWriteStream, readFileSync } from "node:fs";
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

  // Fetch full issue with labels before spawning (saves LLM tokens)
  let fetchedIssue: IssueData | null = null;
  if (issueId) {
    console.log(`Fetching issue ${issueIdentifier} (${issueId}) before spawn...`);
    fetchedIssue = await fetchIssue(issueId);
  }

  const { prompt } = buildClaudeArgs(event, fetchedIssue);

  console.log(`Spawning Claude for ${issueIdentifier} (session ${sessionId})`);

  // Write prompt to file (avoids shell escaping issues with multi-line prompts)
  const sessionsDir = join(targetRepo, ".scottclip", "sessions");
  await mkdir(sessionsDir, { recursive: true });
  const promptPath = join(sessionsDir, `${sessionId}.prompt`);
  const logPath = join(sessionsDir, `${sessionId}.log`);
  await writeFile(promptPath, prompt);

  // Create log file write stream
  const logStream = createWriteStream(logPath);

  // Spawn with pipe for stdout so we can read it
  const child = spawn(CLAUDE_BIN, [
    "-p",
    "--permission-mode", "bypassPermissions",
    "--allowedTools", "mcp__linear-agent*,Read,Write,Edit,Bash,Grep,Glob,Agent",
    "--output-format", "stream-json",
    "--verbose",
  ], {
    cwd: targetRepo,
    stdio: ["pipe", "pipe", "pipe"],
    detached: true,
    env: { ...process.env },
  });

  // Feed prompt via stdin
  const promptContent = readFileSync(promptPath, "utf-8");
  child.stdin?.write(promptContent);
  child.stdin?.end();

  // Write session PID file so stop handler can kill the process
  const sessionFile = join(sessionsDir, `${sessionId}.pid`);
  await writeFile(sessionFile, String(child.pid));
  console.log(`Session file written: ${sessionFile} (PID ${child.pid})`);

  // Parse stream-json lines and post ephemeral activities to Linear
  // Without --include-partial-messages, events are complete turns:
  //   assistant — full message with content array (text + tool_use blocks)
  //   result    — final answer string
  let lastCapturedResult = "";
  let lastTextPostTime = 0;
  let lineBuffer = "";
  const TEXT_DEBOUNCE_MS = 3000;

  child.stdout?.on("data", (chunk: Buffer) => {
    const raw = chunk.toString();
    logStream.write(raw);
    lineBuffer += raw;

    // Process all complete newline-delimited JSON lines
    const lines = lineBuffer.split("\n");
    // Last element may be an incomplete line — keep it in the buffer
    lineBuffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Silently skip non-JSON lines (e.g. ANSI diagnostics)
      let ev: Record<string, unknown>;
      try {
        ev = JSON.parse(trimmed) as Record<string, unknown>;
      } catch {
        continue;
      }

      const type = ev.type as string | undefined;

      if (type === "assistant") {
        // Complete assistant turn — walk content blocks
        const message = ev.message as Record<string, unknown> | undefined;
        const content = message?.content as Array<Record<string, unknown>> | undefined;
        if (!Array.isArray(content)) continue;

        for (const block of content) {
          if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
            // Debounce ephemeral thought posts for rapid successive turns
            const now = Date.now();
            if (now - lastTextPostTime >= TEXT_DEBOUNCE_MS) {
              lastTextPostTime = now;
              ackSession(sessionId, block.text.trim()).catch((err) =>
                console.error("Failed to post text activity:", err),
              );
            }
          } else if (block.type === "tool_use" && typeof block.name === "string") {
            gql(ACK_MUTATION, {
              input: {
                agentSessionId: sessionId,
                content: { type: "action", action: `Using tool: ${block.name}`, parameter: "" },
                ephemeral: true,
              },
            }).catch((err) => console.error("Failed to post tool activity:", err));
          }
        }
      } else if (type === "result") {
        // Final result — capture for use in the exit handler
        if (typeof ev.result === "string") {
          lastCapturedResult = ev.result;
        }
      }
    }
  });

  child.stderr?.on("data", (chunk: Buffer) => {
    logStream.write(chunk.toString());
  });

  // On exit, post final response
  child.on("exit", async (code) => {
    // Flush any remaining incomplete line into the log
    if (lineBuffer.trim()) {
      logStream.write(lineBuffer);
    }
    logStream.end();

    // Use the captured result event; fall back to scanning the log file
    let finalBody = lastCapturedResult.trim();
    if (!finalBody) {
      try {
        const fullLog = await readFile(logPath, "utf-8");
        for (const line of fullLog.split("\n").reverse()) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const parsed = JSON.parse(trimmed) as Record<string, unknown>;
            if (parsed.type === "result" && typeof parsed.result === "string") {
              finalBody = parsed.result.trim();
              break;
            }
          } catch {
            // not JSON — skip
          }
        }
      } catch (err) {
        console.error("Failed to read session log:", err);
      }
    }

    if (finalBody) {
      await gql(ACK_MUTATION, {
        input: {
          agentSessionId: sessionId,
          content: { type: "response", body: finalBody },
        },
      }).catch((err) => console.error("Failed to post final activity:", err));
    }

    // Clean up session files
    try { await unlink(sessionFile); } catch {}
    try { await unlink(promptPath); } catch {}
    console.log(`Session ${sessionId} exited (code ${code})`);
  });

  child.on("error", (err) => {
    console.error(`Failed to spawn Claude for ${issueIdentifier}:`, err);
  });

  child.unref();
}
