import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { gql } from "../graphql.js";

const LIST_TEAMS_QUERY = `
  query ListTeams {
    teams {
      nodes { id name key }
    }
  }
`;

const LIST_USERS_QUERY = `
  query ListUsers {
    users {
      nodes { id name email active }
    }
  }
`;

const VIEWER_QUERY = `
  query Viewer {
    viewer { id name email }
  }
`;

export function registerTeamTools(server: McpServer) {
  server.registerTool(
    "linear_list_teams",
    {
      description: "List workspace teams. Returns id, name, key.",
      inputSchema: {},
    },
    async () => {
      const data = await gql<{ teams: { nodes: unknown[] } }>(LIST_TEAMS_QUERY);
      return { content: [{ type: "text" as const, text: JSON.stringify(data.teams.nodes, null, 2) }] };
    },
  );

  server.registerTool(
    "linear_list_users",
    {
      description: "List workspace members. Returns id, name, email, active status.",
      inputSchema: {},
    },
    async () => {
      const data = await gql<{ users: { nodes: unknown[] } }>(LIST_USERS_QUERY);
      return { content: [{ type: "text" as const, text: JSON.stringify(data.users.nodes, null, 2) }] };
    },
  );

  server.registerTool(
    "linear_get_viewer",
    {
      description: "Get the authenticated entity (the OAuth app). Returns id, name. Used for 'me' resolution.",
      inputSchema: {},
    },
    async () => {
      const data = await gql<{ viewer: unknown }>(VIEWER_QUERY);
      return { content: [{ type: "text" as const, text: JSON.stringify(data.viewer, null, 2) }] };
    },
  );
}
