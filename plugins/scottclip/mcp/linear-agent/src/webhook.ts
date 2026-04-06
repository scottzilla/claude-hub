import { Hono } from "hono";
import { createHmac, randomUUID } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { AGENT_DIR } from "./auth.js";
import { ackSession, spawnClaudeSession } from "./spawn.js";

const EVENTS_DIR = join(AGENT_DIR, "events");

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

      if (event.type === "AgentSessionEvent" && event.data?.id) {
        const sessionId = event.data.id as string;

        if (event.action === "created") {
          ackSession(sessionId, "Starting up...").catch((err) =>
            console.error("Ack error:", err)
          );
          spawnClaudeSession(event).catch((err) => console.error("Spawn error:", err));
        } else if (event.action === "prompted") {
          ackSession(sessionId, "Reading your message...").catch((err) =>
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
