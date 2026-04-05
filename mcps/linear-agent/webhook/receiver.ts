#!/usr/bin/env node

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHmac, randomUUID } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

const PORT = parseInt(process.env.WEBHOOK_PORT || "3847", 10);
const SECRET = process.env.LINEAR_WEBHOOK_SECRET;
const EVENTS_DIR = join(process.env.LINEAR_AGENT_DIR || join(homedir(), ".linear-agent"), "events");

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

    console.log(`Event received: ${event.type || "unknown"} → ${filename}`);
    res.writeHead(200);
    res.end("OK");
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
