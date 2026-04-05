import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { pollEvents, getEventStats } from "../events.js";

export function registerEventTools(server: McpServer) {
  server.registerTool(
    "linear_poll_events",
    {
      description: "Read pending webhook events from the event queue. Returns events sorted chronologically and deletes consumed files. Empty array if none.",
      inputSchema: {
        types: z.array(z.string()).optional().describe("Filter by event type (e.g. ['AgentSessionEvent'])"),
      },
    },
    async (args) => {
      const events = await pollEvents(args.types);
      return { content: [{ type: "text" as const, text: JSON.stringify(events, null, 2) }] };
    },
  );

  server.registerTool(
    "linear_get_webhook_status",
    {
      description: "Check webhook event queue health: pending count and last event timestamp.",
      inputSchema: {},
    },
    async () => {
      const stats = await getEventStats();
      return { content: [{ type: "text" as const, text: JSON.stringify(stats, null, 2) }] };
    },
  );
}
