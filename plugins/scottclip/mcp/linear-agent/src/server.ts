#!/usr/bin/env node

import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { randomUUID } from "node:crypto";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { registerIssueTools } from "./tools/issues.js";
import { registerRelationTools } from "./tools/relations.js";
import { registerCommentTools } from "./tools/comments.js";
import { registerLabelTools } from "./tools/labels.js";
import { registerTeamTools } from "./tools/teams.js";
import { registerDocumentTools } from "./tools/documents.js";
import { registerSessionTools } from "./tools/sessions.js";
import { registerStateTools } from "./tools/states.js";
import { createWebhookRoute } from "./webhook.js";
import { createOAuthRoute, createStatusRoute } from "./oauth.js";
import { loadDotEnv } from "./env.js";

// Load .scottclip/.env before anything reads process.env
loadDotEnv();

const PORT = parseInt(process.env.WEBHOOK_PORT || "3847", 10);

// --- MCP Server Setup ---

function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "linear-agent",
    version: "0.1.0",
  });

  registerIssueTools(server);
  registerRelationTools(server);
  registerCommentTools(server);
  registerLabelTools(server);
  registerTeamTools(server);
  registerDocumentTools(server);
  registerSessionTools(server);
  registerStateTools(server);

  return server;
}

// Track active transports by session ID
const transports = new Map<string, WebStandardStreamableHTTPServerTransport>();

// --- Hono App ---

const app = new Hono();

// MCP Streamable HTTP endpoint
app.all("/mcp", async (c) => {
  const sessionId = c.req.header("mcp-session-id");

  if (c.req.method === "GET" || c.req.method === "DELETE") {
    // GET = SSE stream reconnect, DELETE = session close
    if (!sessionId || !transports.has(sessionId)) {
      return c.text("No active session", 400);
    }
    const transport = transports.get(sessionId)!;
    return transport.handleRequest(c.req.raw);
  }

  // POST — either initialize a new session or send to existing one
  if (sessionId && transports.has(sessionId)) {
    const transport = transports.get(sessionId)!;
    return transport.handleRequest(c.req.raw);
  }

  // New session
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (id) => {
      transports.set(id, transport);
      console.log(`MCP session initialized: ${id}`);
    },
    onsessionclosed: (id) => {
      transports.delete(id);
      console.log(`MCP session closed: ${id}`);
    },
  });

  await createMcpServer().connect(transport);
  return transport.handleRequest(c.req.raw);
});

// Webhook endpoint
app.route("/webhook", createWebhookRoute());

// OAuth endpoint
app.route("/oauth", createOAuthRoute());

// Status page
app.route("/", createStatusRoute());

// --- Start Server ---

async function main() {
  serve(
    {
      fetch: app.fetch,
      port: PORT,
    },
    (info) => {
      console.log(`ScottClip linear-agent server listening on port ${info.port}`);
      console.log(`  MCP:     http://localhost:${info.port}/mcp`);
      console.log(`  Webhook: http://localhost:${info.port}/webhook`);
      console.log(`  OAuth:   http://localhost:${info.port}/oauth/callback`);
      console.log(`  Status:  http://localhost:${info.port}/`);

      // Write PID file so init/status skills can track the running server
      const pidPath = join(process.cwd(), ".scottclip", ".server.pid");
      try {
        writeFileSync(pidPath, String(process.pid));
      } catch {
        // .scottclip dir might not exist yet — not fatal
      }
    }
  );

  // Graceful shutdown
  const shutdown = () => {
    console.log("Shutting down...");
    for (const [id, transport] of transports) {
      transport.close?.();
      transports.delete(id);
    }
    // Clean up PID file
    const pidPath = join(process.cwd(), ".scottclip", ".server.pid");
    try {
      unlinkSync(pidPath);
    } catch {
      // File may not exist — not fatal
    }
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
