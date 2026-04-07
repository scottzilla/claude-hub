import { Hono } from "hono";
import { createHmac, randomUUID } from "node:crypto";
import { writeFile, mkdir, readFile, unlink } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AGENT_DIR } from "./auth.js";
import { ackSession, spawnClaudeSession } from "./spawn.js";

const EVENTS_DIR = join(AGENT_DIR, "events");

function getConfiguredTeamId(): string | null {
  const agentCwd = process.env.AGENT_CWD || process.cwd();
  try {
    const raw = readFileSync(join(agentCwd, ".scottclip", "config.yaml"), "utf-8");
    const match = raw.match(/^\s*team_id:\s*"?([^"\n]+)"?/m);
    return match ? match[1].trim() : null;
  } catch {
    return null;
  }
}

export function verifySignature(
  body: string,
  signature: string | null,
  secret: string | undefined
): boolean {
  if (!secret) return false;
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  const match = signature === expected;
  if (!match) {
    console.error(
      `Signature mismatch — expected: ${expected.substring(0, 16)}..., got: ${signature.substring(0, 16)}...`
    );
  }
  return match;
}

async function ensureEventsDir(): Promise<void> {
  await mkdir(EVENTS_DIR, { recursive: true });
}

export function createWebhookRoute(): Hono {
  const app = new Hono();

  app.post("/", async (c) => {
    const secret = process.env.LINEAR_WEBHOOK_SECRET;
    const body = await c.req.text();
    const signature = c.req.header("linear-signature") ?? null;

    if (!verifySignature(body, signature, secret)) {
      console.error("Invalid webhook signature");
      return c.text("Invalid signature", 401);
    }

    try {
      const event = JSON.parse(body);
      const enriched = {
        ...event,
        receivedAt: new Date().toISOString(),
      };

      await ensureEventsDir();
      const filename = `${Date.now()}-${randomUUID()}.json`;
      await writeFile(join(EVENTS_DIR, filename), JSON.stringify(enriched, null, 2));

      console.log(
        `Event received: ${event.type || "unknown"} (${event.action || "?"}) -> ${filename}`
      );

      // Respond 200 immediately, then handle async work
      const response = c.text("OK", 200);

      if (event.type === "AgentSessionEvent") {
        const sessionData = event.agentSession || event.data;
        if (!sessionData?.id) return response;

        const sessionId = sessionData.id as string;

        // Stop signal first — don't do any other work
        const signal = event.agentActivity?.signal;
        if (signal === "stop") {
          console.log(`Stop signal received for session ${sessionId}`);
          const agentCwd = process.env.AGENT_CWD || process.cwd();
          const sessionsDir = join(agentCwd, ".scottclip", "sessions");
          const sessionFile = join(sessionsDir, `${sessionId}.pid`);
          try {
            const pid = parseInt(await readFile(sessionFile, "utf-8"), 10);
            if (pid) {
              process.kill(pid, "SIGTERM");
              console.log(`Killed session ${sessionId} (PID ${pid})`);
            }
            await unlink(sessionFile);
          } catch {
            console.log(`No active session file for ${sessionId} (may have already finished)`);
          }
        }

        // Team filter — skip events for other teams
        const configuredTeamId = getConfiguredTeamId();
        const issueTeamId = sessionData.issue?.teamId || sessionData.issue?.team?.id;
        if (configuredTeamId && issueTeamId && issueTeamId !== configuredTeamId) {
          console.log(`Ignoring event for team ${issueTeamId} (configured: ${configuredTeamId})`);
          return response;
        }

        if (event.action === "created" || event.action === "prompted") {
          // Ack FIRST (must respond within 5s), then fetch issue and spawn
          const ackMsg = event.action === "created" ? "Starting up..." : "Reading your message...";
          ackSession(sessionId, ackMsg).catch((err) =>
            console.error("Ack error:", err)
          );
          spawnClaudeSession(event).catch((err) => console.error("Spawn error:", err));
        }
      }

      return response;
    } catch (err) {
      console.error("Failed to process webhook:", err);
      return c.text("Internal error", 500);
    }
  });

  return app;
}
