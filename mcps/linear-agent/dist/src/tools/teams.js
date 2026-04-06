import { z } from "zod";
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
const GET_USER_QUERY = `
  query GetUser($id: String!) {
    user(id: $id) { id name email active displayName }
  }
`;
export function registerTeamTools(server) {
    server.registerTool("linear_list_teams", {
        description: "List workspace teams. Returns id, name, key.",
        inputSchema: {},
    }, async () => {
        const data = await gql(LIST_TEAMS_QUERY);
        return { content: [{ type: "text", text: JSON.stringify(data.teams.nodes, null, 2) }] };
    });
    server.registerTool("linear_list_users", {
        description: "List workspace members. Returns id, name, email, active status.",
        inputSchema: {},
    }, async () => {
        const data = await gql(LIST_USERS_QUERY);
        return { content: [{ type: "text", text: JSON.stringify(data.users.nodes, null, 2) }] };
    });
    server.registerTool("linear_get_viewer", {
        description: "Get the authenticated entity (the OAuth app). Returns id, name. Used for 'me' resolution.",
        inputSchema: {},
    }, async () => {
        const data = await gql(VIEWER_QUERY);
        return { content: [{ type: "text", text: JSON.stringify(data.viewer, null, 2) }] };
    });
    server.registerTool("linear_get_user", {
        description: "Get a user by ID. Returns name, email, active status.",
        inputSchema: {
            userId: z.string().describe("User ID"),
        },
    }, async (args) => {
        const data = await gql(GET_USER_QUERY, { id: args.userId });
        return { content: [{ type: "text", text: JSON.stringify(data.user, null, 2) }] };
    });
}
