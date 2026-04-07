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
        status: z.enum(["active", "complete", "error", "awaitingInput", "stale"]).optional().describe("New session status"),
        externalUrls: z.array(z.object({
          label: z.string(),
          url: z.string(),
        })).optional().describe("External URLs — replaces the entire array"),
        addedExternalUrls: z.array(z.object({
          label: z.string(),
          url: z.string(),
        })).optional().describe("External URLs to add (merged with existing)"),
        removedExternalUrls: z.array(z.string()).optional().describe("External URL IDs or URLs to remove"),
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
      if (args.addedExternalUrls) input.addedExternalUrls = args.addedExternalUrls;
      if (args.removedExternalUrls) input.removedExternalUrls = args.removedExternalUrls;
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
      description: "Emit an activity within an agent session. Type determines shape: thought/elicitation/response/error use body; action uses action/parameter/result. Set ephemeral for thought or action types only.",
      inputSchema: {
        agentSessionId: z.string().describe("Agent session ID"),
        type: z.enum(["thought", "action", "elicitation", "response", "error"]).describe("Activity type"),
        body: z.string().optional().describe("Content body (for thought, elicitation, response, error types)"),
        action: z.string().optional().describe("Action name (for action type)"),
        parameter: z.string().optional().describe("Action parameter (for action type)"),
        result: z.string().optional().describe("Action result (for action type)"),
        ephemeral: z.boolean().optional().describe("If true, activity is replaced by the next one (thought and action types only)"),
      },
    },
    async (args) => {
      const content: Record<string, unknown> = { type: args.type };

      if (args.type === "action") {
        if (args.action) content.action = args.action;
        if (args.parameter) content.parameter = args.parameter;
        if (args.result) content.result = args.result;
      } else {
        if (args.body) content.body = args.body;
      }

      const input: Record<string, unknown> = {
        agentSessionId: args.agentSessionId,
        content,
      };
      if (args.ephemeral) input.ephemeral = true;

      const data = await gql<{
        agentActivityCreate: { success: boolean; agentActivity: unknown };
      }>(CREATE_ACTIVITY_MUTATION, { input });

      return { content: [{ type: "text" as const, text: JSON.stringify(data.agentActivityCreate.agentActivity, null, 2) }] };
    },
  );
}
