#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { workers } from "./workers.js";
import { callModel } from "./call-model.js";

const server = new McpServer({
  name: "claude-workers",
  version: "1.0.0",
});

for (const [toolName, worker] of Object.entries(workers)) {
  server.registerTool(
    toolName,
    {
      description: worker.description,
      inputSchema: {
        task: z
          .string()
          .describe(
            "The task to perform. Be specific and include all necessary details.",
          ),
        context: z
          .string()
          .optional()
          .describe(
            "Optional supporting context: file contents, error messages, " +
              "code snippets, or other material the worker needs to complete the task.",
          ),
      },
    },
    async ({ task, context }) => {
      try {
        const result = await callModel(worker, task, context);
        return {
          content: [{ type: "text" as const, text: result }],
        };
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `Error: ${message}` }],
          isError: true,
        };
      }
    },
  );
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("claude-workers MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
