import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { gql } from "../graphql.js";

const ADD_RELATION_MUTATION = `
  mutation AddRelation($input: IssueRelationCreateInput!) {
    issueRelationCreate(input: $input) {
      success
      issueRelation { id type issue { identifier } relatedIssue { identifier } }
    }
  }
`;

const DELETE_RELATION_MUTATION = `
  mutation DeleteRelation($id: ID!) {
    issueRelationDelete(id: $id) {
      success
    }
  }
`;

const LIST_RELATIONS_QUERY = `
  query IssueRelations($id: ID!) {
    issue(id: $id) {
      relations {
        nodes {
          id
          type
          relatedIssue { id identifier title }
        }
      }
      inverseRelations {
        nodes {
          id
          type
          issue { id identifier title }
        }
      }
    }
  }
`;

export function registerRelationTools(server: McpServer) {
  server.registerTool(
    "linear_set_relation",
    {
      description: "Create a relation between two issues. Types: relatedTo, blocks, blockedBy, duplicate.",
      inputSchema: {
        issueId: z.string().describe("Source issue ID or identifier"),
        type: z.enum(["relatedTo", "blocks", "blockedBy", "duplicate"]).describe("Relation type"),
        relatedIssueId: z.string().describe("Target issue ID or identifier"),
      },
    },
    async (args) => {
      const typeMap: Record<string, string> = {
        relatedTo: "related",
        blocks: "blocks",
        blockedBy: "blocked",
        duplicate: "duplicate",
      };
      const data = await gql<{ issueRelationCreate: { success: boolean; issueRelation: unknown } }>(
        ADD_RELATION_MUTATION,
        { input: { issueId: args.issueId, relatedIssueId: args.relatedIssueId, type: typeMap[args.type] } },
      );
      return { content: [{ type: "text" as const, text: JSON.stringify(data.issueRelationCreate, null, 2) }] };
    },
  );

  server.registerTool(
    "linear_remove_relation",
    {
      description: "Remove a relation between two issues. First lists relations to find the relation ID, then deletes it.",
      inputSchema: {
        issueId: z.string().describe("Source issue ID or identifier"),
        type: z.enum(["relatedTo", "blocks", "blockedBy", "duplicate"]).describe("Relation type to remove"),
        relatedIssueId: z.string().describe("Target issue ID or identifier"),
      },
    },
    async (args) => {
      // Find the relation ID first
      const issueData = await gql<{
        issue: {
          relations: { nodes: Array<{ id: string; type: string; relatedIssue: { id: string } }> };
          inverseRelations: { nodes: Array<{ id: string; type: string; issue: { id: string } }> };
        };
      }>(LIST_RELATIONS_QUERY, { id: args.issueId });

      const allRelations = [
        ...issueData.issue.relations.nodes.map((r) => ({ ...r, targetId: r.relatedIssue.id })),
        ...issueData.issue.inverseRelations.nodes.map((r) => ({ ...r, targetId: r.issue.id })),
      ];

      const match = allRelations.find((r) => r.targetId === args.relatedIssueId);
      if (!match) {
        return { content: [{ type: "text" as const, text: "No matching relation found." }] };
      }

      const data = await gql<{ issueRelationDelete: { success: boolean } }>(
        DELETE_RELATION_MUTATION,
        { id: match.id },
      );
      return { content: [{ type: "text" as const, text: JSON.stringify(data.issueRelationDelete, null, 2) }] };
    },
  );
}
