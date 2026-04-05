import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { gql } from "../graphql.js";

const CREATE_SESSION_MUTATION = `
  mutation CreateSession($issueId: String!) {
    agentSessionCreateOnIssue(issueId: $issueId) {
      success
      agentSession {
        id
        status
        issue { identifier title }
        createdAt
      }
    }
  }
`;

const UPDATE_SESSION_MUTATION = `
  mutation UpdateSession($id: String!, $input: AgentSessionUpdateInput!) {
    agentSessionUpdate(id: $id, input: $input) {
      success
      agentSession {
        id
        status
        plan { content status }
      }
    }
  }
`;

const CREATE_ACTIVITY_MUTATION = `
  mutation CreateActivity($input: AgentActivityCreateInput!) {
    agentActivityCreate(input: $input) {
      success
      agentActivity {
        id
        type
        createdAt
      }
    }
  }
`;

export function registerSessionTools(server: McpServer) {
  server.registerTool(
    "linear_create_session",
    {
      description: "Create an agent session on a Linear issue. Returns sessionId. Sessions track agent work lifecycle in Linear's UI.",
      inputSchema: {
        issueId: z.string().describe("Issue ID or identifier to create session on"),
      },
    },
    async (args) => {
      const data = await gql<{
        agentSessionCreateOnIssue: { success: boolean; agentSession: unknown };
      }>(CREATE_SESSION_MUTATION, { issueId: args.issueId });

      return { content: [{ type: "text" as const, text: JSON.stringify(data.agentSessionCreateOnIssue.agentSession, null, 2) }] };
    },
  );

  server.registerTool(
    "linear_update_session",
    {
      description: "Update an agent session: status, external URLs, or plan checklist. Plan replaces the entire checklist.",
      inputSchema: {
        sessionId: z.string().describe("Session ID"),
        status: z.enum(["active", "complete", "error", "stale"]).optional().describe("New session status"),
        externalUrls: z.array(z.object({
          label: z.string(),
          url: z.string(),
        })).optional().describe("External URLs (e.g. PR links) to display on the session"),
        plan: z.array(z.object({
          content: z.string().describe("Step description"),
          status: z.enum(["pending", "inProgress", "completed", "canceled"]).describe("Step status"),
        })).optional().describe("Plan checklist (replaces entire plan)"),
      },
    },
    async (args) => {
      const input: Record<string, unknown> = {};
      if (args.status) input.status = args.status;
      if (args.externalUrls) input.externalUrls = args.externalUrls;
      if (args.plan) input.plan = args.plan;

      const data = await gql<{
        agentSessionUpdate: { success: boolean; agentSession: unknown };
      }>(UPDATE_SESSION_MUTATION, { id: args.sessionId, input });

      return { content: [{ type: "text" as const, text: JSON.stringify(data.agentSessionUpdate.agentSession, null, 2) }] };
    },
  );

  server.registerTool(
    "linear_create_activity",
    {
      description: "Emit an activity within an agent session. Types: thought (internal reasoning), action (tool use), elicitation (ask user), response (final result), error. Markdown supported.",
      inputSchema: {
        sessionId: z.string().describe("Session ID"),
        type: z.enum(["thought", "action", "elicitation", "response", "error"]).describe("Activity type"),
        body: z.string().describe("Activity content (markdown supported)"),
        ephemeral: z.boolean().optional().default(false).describe("If true, activity is replaced by the next one of the same type"),
      },
    },
    async (args) => {
      const input: Record<string, unknown> = {
        sessionId: args.sessionId,
        type: args.type,
        body: args.body,
      };
      if (args.ephemeral) input.ephemeral = true;

      const data = await gql<{
        agentActivityCreate: { success: boolean; agentActivity: unknown };
      }>(CREATE_ACTIVITY_MUTATION, { input });

      return { content: [{ type: "text" as const, text: JSON.stringify(data.agentActivityCreate.agentActivity, null, 2) }] };
    },
  );
}
