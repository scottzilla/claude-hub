import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { gql } from "../graphql.js";

const LIST_LABELS_QUERY = `
  query ListLabels($teamId: ID) {
    issueLabels(filter: { team: { id: { eq: $teamId } } }, first: 100) {
      nodes {
        id
        name
        color
        parent { id name }
      }
    }
  }
`;

const LIST_ALL_LABELS_QUERY = `
  query ListAllLabels {
    issueLabels(first: 100) {
      nodes {
        id
        name
        color
        parent { id name }
      }
    }
  }
`;

const CREATE_LABEL_MUTATION = `
  mutation CreateLabel($input: IssueLabelCreateInput!) {
    issueLabelCreate(input: $input) {
      success
      issueLabel {
        id
        name
        color
        parent { id name }
      }
    }
  }
`;

export function registerLabelTools(server: McpServer) {
  server.registerTool(
    "linear_list_labels",
    {
      description: "List issue labels, optionally filtered by team.",
      inputSchema: {
        teamId: z.string().optional().describe("Filter labels by team ID"),
      },
    },
    async (args) => {
      const query = args.teamId ? LIST_LABELS_QUERY : LIST_ALL_LABELS_QUERY;
      const variables = args.teamId ? { teamId: args.teamId } : {};

      const data = await gql<{ issueLabels: { nodes: unknown[] } }>(query, variables);
      return { content: [{ type: "text" as const, text: JSON.stringify(data.issueLabels.nodes, null, 2) }] };
    },
  );

  server.registerTool(
    "linear_create_label",
    {
      description: "Create a label. Use parentId to group under a parent label.",
      inputSchema: {
        teamId: z.string().describe("Team ID"),
        name: z.string().describe("Label name"),
        color: z.string().optional().describe("Color hex (e.g. '#ff0000')"),
        parentId: z.string().optional().describe("Parent label ID for grouping"),
      },
    },
    async (args) => {
      const input: Record<string, unknown> = { teamId: args.teamId, name: args.name };
      if (args.color) input.color = args.color;
      if (args.parentId) input.parentId = args.parentId;

      const data = await gql<{ issueLabelCreate: { success: boolean; issueLabel: unknown } }>(
        CREATE_LABEL_MUTATION,
        { input },
      );
      return { content: [{ type: "text" as const, text: JSON.stringify(data.issueLabelCreate.issueLabel, null, 2) }] };
    },
  );
}
