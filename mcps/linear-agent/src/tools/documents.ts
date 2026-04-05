import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { gql } from "../graphql.js";

const SEARCH_DOCS_QUERY = `
  query SearchDocs($term: String!) {
    searchDocuments(term: $term, first: 10, includeComments: false) {
      nodes {
        ... on DocumentSearchResult {
          document {
            id
            title
            content
            project { id name }
            updatedAt
          }
        }
      }
    }
  }
`;

const GET_DOCUMENT_QUERY = `
  query GetDocument($id: String!) {
    document(id: $id) {
      id
      title
      content
      project { id name }
      createdAt
      updatedAt
    }
  }
`;

const GET_ATTACHMENTS_QUERY = `
  query GetAttachments($issueId: String!) {
    issue(id: $issueId) {
      attachments {
        nodes {
          id
          title
          subtitle
          url
          metadata
          createdAt
        }
      }
    }
  }
`;

export function registerDocumentTools(server: McpServer) {
  server.registerTool(
    "linear_search_documents",
    {
      description: "Search project documents in Linear. Returns matching docs with title and content.",
      inputSchema: {
        query: z.string().describe("Search query"),
      },
    },
    async (args) => {
      const data = await gql<{ searchDocuments: { nodes: unknown[] } }>(SEARCH_DOCS_QUERY, { term: args.query });
      return { content: [{ type: "text" as const, text: JSON.stringify(data.searchDocuments.nodes, null, 2) }] };
    },
  );

  server.registerTool(
    "linear_get_document",
    {
      description: "Get a Linear document by ID. Returns full content.",
      inputSchema: {
        documentId: z.string().describe("Document ID"),
      },
    },
    async (args) => {
      const data = await gql<{ document: unknown }>(GET_DOCUMENT_QUERY, { id: args.documentId });
      return { content: [{ type: "text" as const, text: JSON.stringify(data.document, null, 2) }] };
    },
  );

  server.registerTool(
    "linear_get_attachment",
    {
      description: "Get attachments on a Linear issue.",
      inputSchema: {
        issueId: z.string().describe("Issue ID or identifier"),
      },
    },
    async (args) => {
      const data = await gql<{ issue: { attachments: { nodes: unknown[] } } }>(
        GET_ATTACHMENTS_QUERY,
        { issueId: args.issueId },
      );
      return { content: [{ type: "text" as const, text: JSON.stringify(data.issue.attachments.nodes, null, 2) }] };
    },
  );
}
