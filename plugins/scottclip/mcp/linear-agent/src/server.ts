#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerIssueTools } from "./tools/issues.js";
import { registerRelationTools } from "./tools/relations.js";
import { registerCommentTools } from "./tools/comments.js";
import { registerLabelTools } from "./tools/labels.js";
import { registerTeamTools } from "./tools/teams.js";
import { registerDocumentTools } from "./tools/documents.js";
import { registerSessionTools } from "./tools/sessions.js";
import { registerEventTools } from "./tools/events.js";
import { registerStateTools } from "./tools/states.js";

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
registerEventTools(server);
registerStateTools(server);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("linear-agent MCP server running on stdio (26 tools registered)");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
