#!/usr/bin/env node

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHmac, randomUUID } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { spawn } from "node:child_process";
import { getAccessToken } from "../src/auth.js";

const PORT = parseInt(process.env.WEBHOOK_PORT || "3847", 10);
const SECRET = process.env.LINEAR_WEBHOOK_SECRET;
const EVENTS_DIR = join(process.env.LINEAR_AGENT_DIR || join(homedir(), ".linear-agent"), "events");
const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";
const TARGET_REPO = process.env.AGENT_CWD;

if (!SECRET) {
  console.error("LINEAR_WEBHOOK_SECRET is required");
  process.exit(1);
}

function verifySignature(body: string, signature: string | null): boolean {
  if (!signature || !SECRET) return false;
  const expected = createHmac("sha256", SECRET).update(body).digest("hex");
  return signature === expected;
}

async function ensureEventsDir() {
  await mkdir(EVENTS_DIR, { recursive: true, mode: 0o700 });
}

async function linearGql(query: string, variables: Record<string, unknown>): Promise<unknown> {
  const token = await getAccessToken();
  const res = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: token,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    throw new Error(`Linear API error (${res.status}): ${await res.text()}`);
  }
  const json = await res.json() as { data?: unknown; errors?: Array<{ message: string }> };
  if (json.errors?.length) {
    throw new Error(`GraphQL error: ${json.errors.map(e => e.message).join("; ")}`);
  }
  return json.data;
}

const ACK_MUTATION = `
  mutation AckSession($input: AgentActivityCreateInput!) {
    agentActivityCreate(input: $input) {
      success
    }
  }
`;

async function ackSession(sessionId: string, message = "Starting up..."): Promise<void> {
  try {
    await linearGql(ACK_MUTATION, {
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

async function spawnClaude(event: Record<string, unknown>): Promise<void> {
  if (!TARGET_REPO) {
    console.error("AGENT_CWD not set — cannot spawn Claude session");
    return;
  }

  const data = event.data as Record<string, unknown> | undefined;
  const issueIdentifier = data?.issueIdentifier || data?.issueId || "unknown";
  const sessionId = data?.id || "unknown";
  const eventType = event.type as string || "unknown";
  const action = event.action as string || "unknown";

  const activity = data?.agentActivity as Record<string, unknown> | undefined;
  const promptBody = activity?.body as string | undefined;
  const promptContext = data?.promptContext as string | undefined;

  const lines = [
    `Linear agent event: ${eventType} (${action})`,
    `Session: ${sessionId}`,
    `Issue: ${issueIdentifier}`,
  ];

  if (promptBody) {
    lines.push(``, `User message: ${promptBody}`);
  }
  if (promptContext) {
    lines.push(``, `Context:`, promptContext);
  }

  lines.push(``, `Run /heartbeat --issue ${issueIdentifier} to process this issue. The agent session is already acknowledged.`);

  const prompt = lines.join("\n");

  console.log(`Spawning Claude for ${issueIdentifier} (session ${sessionId})`);

  const child = spawn(CLAUDE_BIN, [
    "-p", prompt,
    "--allowedTools", "mcp__linear_agent*,Read,Write,Edit,Bash,Grep,Glob,Agent",
  ], {
    cwd: TARGET_REPO,
    stdio: "ignore",
    detached: true,
    env: { ...process.env },
  });

  child.unref(); // Don't wait for child to exit

  child.on("error", (err) => {
    console.error(`Failed to spawn Claude for ${issueIdentifier}:`, err);
  });
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  if (req.method !== "POST") {
    res.writeHead(405);
    res.end("Method not allowed");
    return;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  const body = Buffer.concat(chunks).toString("utf-8");

  const signature = req.headers["linear-signature"] as string | undefined;
  if (!verifySignature(body, signature ?? null)) {
    console.error("Invalid webhook signature");
    res.writeHead(401);
    res.end("Invalid signature");
    return;
  }

  try {
    const event = JSON.parse(body);
    const enriched = {
      ...event,
      receivedAt: new Date().toISOString(),
    };

    await ensureEventsDir();
    const filename = `${Date.now()}-${randomUUID()}.json`;
    await writeFile(join(EVENTS_DIR, filename), JSON.stringify(enriched, null, 2), { mode: 0o600 });

    console.log(`Event received: ${event.type || "unknown"} (${event.action || "?"}) → ${filename}`);
    res.writeHead(200);
    res.end("OK");

    // Post-response: ack and spawn (non-blocking, errors logged but not thrown)
    if (event.type === "AgentSessionEvent" && event.data?.id) {
      const sessionId = event.data.id as string;

      if (event.action === "created") {
        // New delegation — ack immediately, spawn Claude to do the work
        await ackSession(sessionId, "Starting up...");
        spawnClaude(event).catch((err) => console.error("Spawn error:", err));
      } else if (event.action === "prompted") {
        // User message in existing session — ack immediately, spawn Claude to respond
        await ackSession(sessionId, "Reading your message...");
        spawnClaude(event).catch((err) => console.error("Spawn error:", err));
      }
    }
  } catch (err) {
    console.error("Failed to process webhook:", err);
    res.writeHead(500);
    res.end("Internal error");
  }
});

server.listen(PORT, () => {
  console.log(`Linear webhook receiver listening on port ${PORT}`);
  console.log(`Events directory: ${EVENTS_DIR}`);
  console.log("Expose this with: cloudflared tunnel --url http://localhost:" + PORT);
});
